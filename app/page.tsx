"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Expense } from "@/lib/supabase";

const currency = new Intl.NumberFormat("ko-KR");

const fieldClass =
  "h-14 w-full min-w-0 rounded-xl border-0 bg-[#f2f2f4] px-4 text-lg text-[#1d1d1f] outline-none transition-colors placeholder:text-[#a1a1a6] focus:bg-[#e8e8ed] sm:h-12 sm:text-base";

const buttonClass =
  "h-14 w-full touch-manipulation rounded-xl bg-[#1d1d1f] text-lg font-medium text-white transition-colors hover:bg-[#3a3a3c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d1d1f] disabled:cursor-not-allowed disabled:bg-[#d2d2d7] sm:h-12 sm:text-base";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const welcome: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "지출을 말해 주세요. 예: 어제 점심 9000원",
};

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authSaving, setAuthSaving] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const total = useMemo(
    () => expenses.reduce((sum, item) => sum + item.amount, 0),
    [expenses],
  );

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
      if (!nextSession) {
        setExpenses([]);
        setMessages([welcome]);
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;

    let active = true;
    loadExpenses(userId).then((rows) => {
      if (active && rows) setExpenses(rows);
    });

    return () => {
      active = false;
    };
  }, [session?.user.id]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [messages, sending]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthSaving(true);
    setAuthMessage("");

    const credentials = { email: email.trim(), password };
    const result =
      authMode === "sign-up"
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);

    setAuthSaving(false);

    if (result.error) {
      setAuthMessage(
        authMode === "sign-up"
          ? "가입하지 못했습니다. 이메일과 비밀번호를 확인해 주세요."
          : "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.",
      );
      return;
    }

    if (authMode === "sign-up" && !result.data.session) {
      setAuthMessage("가입 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요.");
      setAuthMode("sign-in");
      setPassword("");
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setDraft("");
    setAuthMessage("");
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    const userId = session?.user.id;
    if (!text || !userId || sending) return;

    setDraft("");
    setSending(true);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const raw = await response.text();
      let body: { reply?: string; error?: string } = {};
      try {
        body = JSON.parse(raw) as { reply?: string; error?: string };
      } catch {
        body = { error: "서버 응답을 읽지 못했습니다." };
      }
      const reply = body.reply || body.error || "답변을 받지 못했습니다.";
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: reply }]);

      if (response.ok) {
        const rows = await loadExpenses(userId);
        if (rows) setExpenses(rows);
      }
    } catch {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: "연결하지 못했습니다. 다시 시도해 주세요." },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function removeExpense(id: number) {
    const userId = session?.user.id;
    if (!userId || deletingId !== null) return;
    if (!window.confirm("이 지출을 삭제할까요?")) return;

    setDeletingId(id);
    const { error } = await supabase.from("expense").delete().eq("id", id).eq("user_id", userId);
    setDeletingId(null);

    if (error) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: "삭제하지 못했습니다. 다시 시도해 주세요." },
      ]);
      return;
    }

    const rows = await loadExpenses(userId);
    if (rows) setExpenses(rows);
  }

  return (
    <div className="min-h-dvh bg-[#f5f5f7] text-[#1d1d1f]">
      {!authReady ? (
        <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center px-5">
          <p className="text-base text-[#6e6e73] sm:text-sm">로그인 상태를 확인하고 있습니다.</p>
        </main>
      ) : !session ? (
        <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-10 px-5 py-10">
          <header>
            <h1 className="text-4xl font-semibold tracking-tight">AI 가계부 챗봇</h1>
          </header>
          <form className="flex flex-col gap-8 rounded-[28px] bg-white px-5 py-7 sm:gap-6 sm:px-10 sm:py-10" onSubmit={handleAuth}>
            <div>
              <h2 className="text-xl font-medium sm:text-lg">{authMode === "sign-in" ? "로그인" : "회원가입"}</h2>
              <p className="mt-2 text-base text-[#6e6e73] sm:text-sm">로그인해야 가계부를 사용할 수 있습니다.</p>
            </div>
            <label className="flex min-w-0 flex-col gap-3 text-base font-medium text-[#6e6e73] sm:gap-2 sm:text-sm">
              이메일
              <input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className={fieldClass}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-3 text-base font-medium text-[#6e6e73] sm:gap-2 sm:text-sm">
              비밀번호
              <input
                type="password"
                name="password"
                autoComplete={authMode === "sign-in" ? "current-password" : "new-password"}
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className={fieldClass}
              />
            </label>
            <button type="submit" disabled={authSaving} className={buttonClass}>
              {authSaving ? "처리 중..." : authMode === "sign-in" ? "로그인" : "가입하기"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in");
                setAuthMessage("");
              }}
              className="text-left text-base text-[#6e6e73] hover:text-[#1d1d1f] sm:text-sm"
            >
              {authMode === "sign-in" ? "계정이 없으면 가입하기" : "이미 계정이 있으면 로그인"}
            </button>
            {authMessage ? (
              <p className="text-base text-[#6e6e73] sm:text-sm" role="status">
                {authMessage}
              </p>
            ) : null}
          </form>
        </main>
      ) : (
        <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col">
          <header className="flex items-center justify-between gap-4 px-5 py-4">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI 가계부 챗봇</h1>
            <button
              type="button"
              onClick={handleSignOut}
              className="shrink-0 text-base text-[#6e6e73] hover:text-[#1d1d1f] sm:text-sm"
            >
              로그아웃
            </button>
          </header>

          <section className="px-5" aria-label="저장된 지출">
            <p className="mb-3 text-base text-[#6e6e73] sm:text-sm">
              합계{" "}
              <span className="numeric text-2xl font-semibold tracking-tight text-[#1d1d1f] sm:text-xl">
                {currency.format(total)}원
              </span>
            </p>
            {expenses.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-4 text-base text-[#6e6e73] sm:text-sm">
                아직 저장된 지출이 없습니다.
              </p>
            ) : (
              <ul className="flex gap-3 overflow-x-auto pb-2">
                {expenses.map((expense) => (
                  <li
                    key={expense.id}
                    className="flex w-56 shrink-0 flex-col rounded-2xl bg-white px-4 py-4 sm:w-64"
                  >
                    <p className="text-base text-[#6e6e73] sm:text-sm">{formatDate(expense.date)}</p>
                    <p className="numeric mt-2 text-2xl font-semibold tracking-tight">
                      {currency.format(expense.amount)}
                      <span className="ml-1 text-base font-medium text-[#6e6e73] sm:text-sm">원</span>
                    </p>
                    <p className="mt-2 line-clamp-2 text-lg sm:text-base">{expense.description}</p>
                    <button
                      type="button"
                      onClick={() => removeExpense(expense.id)}
                      disabled={deletingId === expense.id}
                      className="mt-4 self-start text-base text-[#6e6e73] hover:text-[#1d1d1f] disabled:text-[#d2d2d7] sm:text-sm"
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div ref={threadRef} className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
            {messages.map((message) => (
              <p
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#1d1d1f] px-4 py-3 text-lg text-white sm:text-base"
                    : "mr-auto max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-white px-4 py-3 text-lg sm:text-base"
                }
              >
                {message.text}
              </p>
            ))}
            {sending ? (
              <p className="mr-auto rounded-2xl rounded-bl-md bg-white px-4 py-3 text-lg text-[#6e6e73] sm:text-base">
                기록하는 중...
              </p>
            ) : null}
          </div>

          <form className="flex items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2" onSubmit={handleSend}>
            <label className="min-w-0 flex-1">
              <span className="sr-only">메시지</span>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="어제 점심 9000원"
                maxLength={500}
                className="h-14 w-full rounded-full border-0 bg-white px-5 text-lg outline-none placeholder:text-[#a1a1a6] focus:bg-[#f2f2f4] sm:h-12 sm:text-base"
              />
            </label>
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="h-14 shrink-0 touch-manipulation rounded-full bg-[#1d1d1f] px-5 text-lg font-medium text-white transition-colors hover:bg-[#3a3a3c] disabled:bg-[#d2d2d7] sm:h-12 sm:text-base"
            >
              전송
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

async function loadExpenses(userId: string) {
  const { data, error } = await supabase
    .from("expense")
    .select("id, created_at, date, amount, description, user_id")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return null;
  return data ?? [];
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${year}년 ${month}월 ${day}일`;
}
