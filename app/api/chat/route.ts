import { GoogleGenAI, Type } from "@google/genai";
import { GEMINI_MODEL } from "@/lib/gemini";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Expense } from "@/lib/supabase";

const currency = new Intl.NumberFormat("ko-KR");
const usageGuide = "지출을 말해 주세요. 예: 어제 택시 2만 원\n통계도 물어볼 수 있어요. 예: 이번 달 총 지출이 얼마야?";
const askAgain = "날짜나 금액을 알 수 없어요. 예: 어제 택시 2만 원";
const askPeriod = "어느 기간인지 다시 말해 주세요. 예: 이번 달, 지난주, 어제";
const retryLater = "잠시 후 다시 시도해 주세요.";

type DraftExpense = {
  date: string;
  amount: number;
  description: string;
};

type ExpenseRow = {
  date: string;
  amount: number;
  description: string;
};

type QuestionKind = "total" | "largest" | "list" | "category";

type ParsedMessage = {
  type?: unknown;
  expenses?: unknown;
  reply?: unknown;
  question?: {
    startDate?: unknown;
    endDate?: unknown;
    kind?: unknown;
    category?: unknown;
  };
};

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: retryLater }, { status: 500 });
  }

  let message = "";
  try {
    const body = (await request.json()) as { message?: unknown };
    message = typeof body.message === "string" ? body.message.trim() : "";
  } catch {
    return Response.json({ error: "메시지를 읽지 못했습니다." }, { status: 400 });
  }

  if (!message || message.length > 500) {
    return Response.json({ error: "메시지는 1자 이상 500자 이하로 보내 주세요." }, { status: 400 });
  }

  const today = koreaToday();
  const periods = knownPeriods(today);
  const ai = new GoogleGenAI({ apiKey });

  let parsed: ParsedMessage;
  try {
    parsed = await classifyMessage(ai, message, today, periods);
  } catch {
    return Response.json({ error: retryLater }, { status: 502 });
  }

  const type = parsed.type === "expense" || parsed.type === "question" || parsed.type === "other" ? parsed.type : "other";

  if (type === "expense") {
    const drafts = validExpenses(parsed.expenses);
    if (drafts.length === 0) {
      return Response.json({ saved: [], reply: textOr(parsed.reply, askAgain) });
    }

    const { data, error } = await supabase
      .from("expense")
      .insert(drafts.map((draft) => ({ date: draft.date, amount: draft.amount, description: draft.description })))
      .select("id, created_at, date, amount, description, user_id");

    if (error || !data) {
      return Response.json({ error: "저장하지 못했습니다. 다시 시도해 주세요." }, { status: 500 });
    }

    return Response.json({
      saved: data satisfies Expense[],
      reply: savedReply(data),
    });
  }

  if (type !== "question") {
    return Response.json({ saved: [], reply: textOr(parsed.reply, usageGuide) });
  }

  const question = readQuestion(parsed.question);
  if (!question) {
    return Response.json({ saved: [], reply: askPeriod });
  }

  const { data, error } = await supabase
    .from("expense")
    .select("date, amount, description, created_at")
    .gte("date", question.startDate)
    .lte("date", question.endDate)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error || !data) {
    return Response.json({ error: "지출을 불러오지 못했습니다. 다시 시도해 주세요." }, { status: 500 });
  }

  const rows = data.flatMap((row) => {
    const amount = Number(row.amount);
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const date = typeof row.date === "string" ? row.date : "";
    if (!isIsoDate(date) || !Number.isInteger(amount) || amount <= 0 || !description) return [];
    return [{ date, amount, description }];
  });

  if (rows.length === 0) {
    return Response.json({ saved: [], reply: "아직 기록이 없어요." });
  }

  try {
    const reply = await answerQuestion(ai, question, rows, periods);
    return Response.json({ saved: [], reply });
  } catch {
    return Response.json({ error: retryLater }, { status: 502 });
  }
}

async function classifyMessage(
  ai: GoogleGenAI,
  message: string,
  today: string,
  periods: ReturnType<typeof knownPeriods>,
) {
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      "사용자 메시지가 지출 입력, 지출 질문, 그 외 중 무엇인지 판단하세요.",
      `오늘 날짜는 한국 시간(Asia/Seoul) 기준 ${today}입니다.`,
      `어제: ${periods.yesterday}`,
      `그저께: ${periods.dayBefore}`,
      `이번 달: ${periods.monthStart}부터 ${today}까지`,
      `지난주: ${periods.lastWeekStart}부터 ${periods.lastWeekEnd}까지 (월요일부터 일요일)`,
      "이번 달이나 지난주를 물으면 위 날짜를 그대로 쓰세요.",
      "지출 입력이면 type은 expense입니다. 날짜가 없으면 오늘을 쓰고, 금액은 원 단위 정수, 내용은 짧은 명사로 적으세요.",
      "2만 원은 20000, 1만 5천 원은 15000입니다.",
      "지출인데 날짜나 금액을 정할 수 없으면 type은 expense로 두되 expenses는 빈 배열로 하세요.",
      "질문이면 type은 question입니다. 조회 기간과 질문 종류만 정하세요. 합계는 계산하지 마세요.",
      "질문 종류는 total(총액), largest(가장 큰 항목), list(그 기간에 산 것), category(식비처럼 내용으로 묶는 질문)입니다.",
      "category면 category에 기준 단어를 적으세요. 예: 식비.",
      "인사나 사용법 질문이면 type은 other입니다.",
      `사용자 말: ${message}`,
    ].join("\n"),
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: ["expense", "question", "other"] },
          expenses: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                amount: { type: Type.INTEGER },
                description: { type: Type.STRING },
              },
              required: ["date", "amount", "description"],
            },
          },
          question: {
            type: Type.OBJECT,
            properties: {
              startDate: { type: Type.STRING },
              endDate: { type: Type.STRING },
              kind: { type: Type.STRING, enum: ["total", "largest", "list", "category"] },
              category: { type: Type.STRING },
            },
            required: ["startDate", "endDate", "kind"],
          },
          reply: { type: Type.STRING },
        },
        required: ["type"],
      },
    },
  });

  return JSON.parse(response.text ?? "{}") as ParsedMessage;
}

async function answerQuestion(
  ai: GoogleGenAI,
  question: { startDate: string; endDate: string; kind: QuestionKind; category: string },
  rows: ExpenseRow[],
  periods: ReturnType<typeof knownPeriods>,
) {
  const periodLabel = labelForPeriod(question.startDate, question.endDate, periods);

  if (question.kind === "category") {
    const picked = await pickCategoryRows(ai, question.category, rows);
    if (picked.length === 0) {
      return `${periodLabel}에는 ${question.category}로 볼 기록이 없어요.`;
    }
    const sum = picked.reduce((total, row) => total + row.amount, 0);
    const names = uniqueDescriptions(picked);
    const facts = [
      `${periodLabel} ${question.category} 합계는 ${won(sum)}이에요.`,
      `${question.category}로 센 항목은 ${names.join(", ")}이에요.`,
      ...picked.map((row) => itemLine(row)),
    ].join("\n");
    return phraseOrFacts(ai, facts, [won(sum), ...names]);
  }

  if (question.kind === "largest") {
    const max = Math.max(...rows.map((row) => row.amount));
    const top = rows.filter((row) => row.amount === max);
    const facts = `가장 많이 쓴 항목은 ${top.map((row) => `${row.description} ${won(row.amount)}`).join(", ")}이에요.`;
    return phraseOrFacts(ai, facts, top.map((row) => won(row.amount)));
  }

  if (question.kind === "list") {
    const facts = `${periodLabel} 기록은 ${rows.map((row) => `${formatDay(row.date)} ${row.description} ${won(row.amount)}`).join(", ")}이에요.`;
    return phraseOrFacts(ai, facts, rows.map((row) => won(row.amount)));
  }

  const sum = rows.reduce((total, row) => total + row.amount, 0);
  const facts = `${periodLabel}에는 총 ${won(sum)}을 썼어요.`;
  return phraseOrFacts(ai, facts, [won(sum)]);
}

async function pickCategoryRows(ai: GoogleGenAI, category: string, rows: ExpenseRow[]) {
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      `아래 지출 내용 중에서 ${category}에 해당하는 번호만 고르세요.`,
      "합계는 계산하지 마세요. 목록에 없는 내용을 만들지 마세요.",
      ...rows.map((row, index) => `${index}: ${row.date} ${row.description} ${row.amount}`),
    ].join("\n"),
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          indexes: { type: Type.ARRAY, items: { type: Type.INTEGER } },
        },
        required: ["indexes"],
      },
    },
  });
  const parsed = JSON.parse(response.text ?? "{}") as { indexes?: unknown };
  if (!Array.isArray(parsed.indexes)) return [];
  const chosen = new Set<number>();
  for (const value of parsed.indexes) {
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < rows.length) chosen.add(index);
  }
  return [...chosen].map((index) => rows[index]);
}

async function phraseOrFacts(ai: GoogleGenAI, facts: string, requiredSnippets: string[]) {
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        "아래 계산 결과를 자연스럽고 친근한 한국어 한두 문장으로 말해 주세요.",
        "금액은 적힌 문자열을 그대로 쓰세요. 숫자를 바꾸거나 새로 계산하지 마세요.",
        "어떤 항목을 포함했는지도 빠뜨리지 마세요.",
        facts,
      ].join("\n"),
    });
    const text = (response.text ?? "").trim();
    if (text && requiredSnippets.every((snippet) => text.includes(snippet))) return text;
  } catch {
    return facts;
  }
  return facts;
}

function readQuestion(value: ParsedMessage["question"]): {
  startDate: string;
  endDate: string;
  kind: QuestionKind;
  category: string;
} | null {
  if (!value) return null;
  const startDate = typeof value.startDate === "string" ? value.startDate : "";
  const endDate = typeof value.endDate === "string" ? value.endDate : "";
  const kind = value.kind;
  const category = typeof value.category === "string" ? value.category.trim() : "";
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) return null;
  if (kind !== "total" && kind !== "largest" && kind !== "list" && kind !== "category") return null;
  if (kind === "category" && !category) return null;
  return { startDate, endDate, kind, category };
}

function knownPeriods(today: string) {
  const monthStart = `${today.slice(0, 8)}01`;
  const yesterday = addDays(today, -1);
  const dayBefore = addDays(today, -2);
  const weekday = utcWeekday(today);
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  const thisWeekStart = addDays(today, -daysSinceMonday);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const lastWeekEnd = addDays(lastWeekStart, 6);
  return { today, monthStart, yesterday, dayBefore, lastWeekStart, lastWeekEnd };
}

function labelForPeriod(startDate: string, endDate: string, periods: ReturnType<typeof knownPeriods>) {
  if (startDate === periods.monthStart && endDate === periods.today) return "이번 달";
  if (startDate === periods.lastWeekStart && endDate === periods.lastWeekEnd) return "지난주";
  if (startDate === periods.yesterday && endDate === periods.yesterday) return "어제";
  if (startDate === periods.dayBefore && endDate === periods.dayBefore) return "그저께";
  if (startDate === periods.today && endDate === periods.today) return "오늘";
  if (startDate === endDate) return formatDay(startDate);
  return `${formatDay(startDate)}부터 ${formatDay(endDate)}까지`;
}

function itemLine(row: ExpenseRow) {
  return `${formatDay(row.date)} ${row.description} ${won(row.amount)}`;
}

function uniqueDescriptions(rows: ExpenseRow[]) {
  return [...new Set(rows.map((row) => row.description))];
}

function won(amount: number) {
  return `${currency.format(amount)}원`;
}

function formatDay(value: string) {
  const [, month, day] = value.split("-").map(Number);
  return `${month}월 ${day}일`;
}

function textOr(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim().slice(0, 300) : "";
  return text || fallback;
}

function validExpenses(value: unknown): DraftExpense[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const drafts: DraftExpense[] = [];
  for (const item of value) {
    const draft = toDraft(item);
    if (!draft) return [];
    drafts.push(draft);
  }
  return drafts;
}

function toDraft(item: unknown): DraftExpense | null {
  if (!item || typeof item !== "object") return null;
  const record = item as { date?: unknown; amount?: unknown; description?: unknown };
  const date = typeof record.date === "string" ? record.date : "";
  const amount = Number(record.amount);
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (!isIsoDate(date) || !Number.isInteger(amount) || amount <= 0 || !description || description.length > 80) {
    return null;
  }
  return { date, amount, description };
}

function koreaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function utcWeekday(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function savedReply(rows: { date: string; amount: number; description: string }[]) {
  return rows
    .map((row) => `${formatDay(row.date)} ${row.description} ${won(row.amount)}을 저장했어요!`)
    .join("\n");
}
