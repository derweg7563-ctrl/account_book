"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Expense } from "@/lib/supabase";

const currency = new Intl.NumberFormat("ko-KR");

const fieldClass =
  "h-14 w-full min-w-0 rounded-xl border-0 bg-[#f2f2f4] px-4 text-lg text-[#1d1d1f] outline-none transition-colors placeholder:text-[#a1a1a6] focus:bg-[#e8e8ed] sm:h-12 sm:text-base";

const buttonClass =
  "h-14 w-full touch-manipulation rounded-xl bg-[#1d1d1f] text-lg font-medium text-white transition-colors hover:bg-[#3a3a3c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d1d1f] disabled:cursor-not-allowed disabled:bg-[#d2d2d7] sm:h-12 sm:text-base";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const total = useMemo(
    () => expenses.reduce((sum, item) => sum + item.amount, 0),
    [expenses],
  );

  async function loadExpenses(userId: string) {
    const { data, error } = await supabase
      .from("expense")
      .select("id, created_at, date, amount, description, user_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      setMessage("지출 내역을 불러오지 못했습니다.");
      return;
    }

    setExpenses(data ?? []);
  }

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
      if (!data.session) setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
      if (!nextSession) {
        setExpenses([]);
        setLoading(false);
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
    setLoading(true);

    loadExpenses(userId).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [session?.user.id]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    const credentials = { email: email.trim(), password };
    const result =
      authMode === "sign-up"
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);

    setSaving(false);

    if (result.error) {
      setMessage(
        authMode === "sign-up"
          ? "가입하지 못했습니다. 이메일과 비밀번호를 확인해 주세요."
          : "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.",
      );
      return;
    }

    if (authMode === "sign-up" && !result.data.session) {
      setMessage("가입 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요.");
      setAuthMode("sign-in");
      setPassword("");
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setDate("");
    setAmount("");
    setDescription("");
    setEditingId(null);
    setMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userId = session?.user.id;
    const parsed = Number(amount.replaceAll(",", "").trim());

    if (!userId || !date || !description.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setMessage("날짜, 금액, 내용을 모두 올바르게 입력해 주세요.");
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase.from("expense").insert({
      date,
      amount: Math.round(parsed),
      description: description.trim(),
      user_id: userId,
    });

    if (error) {
      setSaving(false);
      setMessage("저장하지 못했습니다. 다시 시도해 주세요.");
      return;
    }

    await loadExpenses(userId);
    setDate("");
    setAmount("");
    setDescription("");
    setSaving(false);
    setMessage("저장되었습니다.");
  }

  function startEdit(expense: Expense) {
    setEditingId(expense.id);
    setEditDate(expense.date);
    setEditAmount(String(expense.amount));
    setEditDescription(expense.description);
    setMessage("");
  }

  async function saveEdit(id: number) {
    const userId = session?.user.id;
    const parsed = Number(editAmount.replaceAll(",", "").trim());

    if (!userId || !editDate || !editDescription.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setMessage("날짜, 금액, 내용을 모두 올바르게 입력해 주세요.");
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("expense")
      .update({
        date: editDate,
        amount: Math.round(parsed),
        description: editDescription.trim(),
      })
      .eq("id", id)
      .eq("user_id", userId);

    setSaving(false);

    if (error) {
      setMessage("수정하지 못했습니다. 다시 시도해 주세요.");
      return;
    }

    setEditingId(null);
    await loadExpenses(userId);
    setMessage("수정되었습니다.");
  }

  async function removeExpense(id: number) {
    const userId = session?.user.id;
    if (!userId) return;
    if (!window.confirm("이 지출을 삭제할까요?")) return;

    setSaving(true);
    setMessage("");

    const { error } = await supabase.from("expense").delete().eq("id", id).eq("user_id", userId);

    setSaving(false);

    if (error) {
      setMessage("삭제하지 못했습니다. 다시 시도해 주세요.");
      return;
    }

    if (editingId === id) setEditingId(null);
    await loadExpenses(userId);
    setMessage("삭제되었습니다.");
  }

  return (
    <div className="min-h-full overflow-x-hidden bg-[#f5f5f7] px-5 py-10 text-[#1d1d1f] sm:px-8 sm:py-16">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-10 sm:gap-14">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-base text-[#6e6e73] sm:text-sm">오늘도 가볍게 기록하기</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">나의 스마트 가계부</h1>
          </div>
          {session ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-3 shrink-0 text-base text-[#6e6e73] hover:text-[#1d1d1f] sm:text-sm"
            >
              로그아웃
            </button>
          ) : null}
        </header>

        <main className="w-full rounded-[28px] bg-white px-5 py-7 sm:px-10 sm:py-10">
          {!authReady ? (
            <p className="text-base text-[#6e6e73] sm:text-sm">로그인 상태를 확인하고 있습니다.</p>
          ) : !session ? (
            <form className="flex flex-col gap-8 sm:gap-6" onSubmit={handleAuth}>
              <div>
                <h2 className="text-xl font-medium sm:text-lg">
                  {authMode === "sign-in" ? "로그인" : "회원가입"}
                </h2>
                <p className="mt-2 text-base text-[#6e6e73] sm:text-sm">
                  내 지출만 보고 기록할 수 있습니다.
                </p>
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
              <button type="submit" disabled={saving} className={buttonClass}>
                {saving ? "처리 중..." : authMode === "sign-in" ? "로그인" : "가입하기"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in");
                  setMessage("");
                }}
                className="text-left text-base text-[#6e6e73] hover:text-[#1d1d1f] sm:text-sm"
              >
                {authMode === "sign-in" ? "계정이 없으면 가입하기" : "이미 계정이 있으면 로그인"}
              </button>
              {message ? (
                <p className="text-base text-[#6e6e73] sm:text-sm" role="status">
                  {message}
                </p>
              ) : null}
            </form>
          ) : (
            <>
              <p className="text-base text-[#6e6e73] sm:text-sm">{session.user.email}</p>
              <form className="mt-8 flex flex-col gap-8 sm:gap-6" onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-6">
                  <label className="flex min-w-0 flex-col gap-3 text-base font-medium text-[#6e6e73] sm:gap-2 sm:text-sm">
                    날짜
                    <input
                      type="date"
                      name="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      required
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex min-w-0 flex-col gap-3 text-base font-medium text-[#6e6e73] sm:gap-2 sm:text-sm">
                    금액
                    <input
                      type="number"
                      name="amount"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      placeholder="0"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      required
                      className={`${fieldClass} numeric`}
                    />
                  </label>
                </div>

                <label className="flex min-w-0 flex-col gap-3 text-base font-medium text-[#6e6e73] sm:gap-2 sm:text-sm">
                  내용
                  <input
                    type="text"
                    name="description"
                    placeholder="예: 점심 식사"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    required
                    className={fieldClass}
                  />
                </label>

                <button type="submit" disabled={saving} className={buttonClass}>
                  {saving ? "저장 중..." : "저장하기"}
                </button>
                {message ? (
                  <p className="text-base text-[#6e6e73] sm:text-sm" role="status">
                    {message}
                  </p>
                ) : null}
              </form>

              <section className="mt-14 sm:mt-16">
                <h2 className="text-xl font-medium sm:text-lg">지출 내역</h2>
                <p className="numeric mt-3 text-4xl font-semibold tracking-tight sm:text-3xl">
                  {currency.format(total)}
                  <span className="ml-1 text-xl font-medium text-[#6e6e73] sm:text-lg">원</span>
                </p>
                {loading ? (
                  <p className="mt-8 text-base text-[#6e6e73] sm:text-sm">
                    지출 내역을 불러오는 중입니다.
                  </p>
                ) : expenses.length === 0 ? (
                  <p className="mt-8 text-base text-[#6e6e73] sm:text-sm">
                    아직 저장된 지출이 없습니다.
                  </p>
                ) : (
                  <ul className="mt-8 flex flex-col">
                    {expenses.map((expense) => (
                      <li key={expense.id} className="py-5">
                        {editingId === expense.id ? (
                          <div className="flex flex-col gap-6">
                            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                              <input
                                type="date"
                                aria-label="날짜 수정"
                                value={editDate}
                                onChange={(event) => setEditDate(event.target.value)}
                                className={fieldClass}
                              />
                              <input
                                type="number"
                                aria-label="금액 수정"
                                min="1"
                                step="1"
                                value={editAmount}
                                onChange={(event) => setEditAmount(event.target.value)}
                                className={`${fieldClass} numeric`}
                              />
                            </div>
                            <input
                              type="text"
                              aria-label="내용 수정"
                              value={editDescription}
                              onChange={(event) => setEditDescription(event.target.value)}
                              className={fieldClass}
                            />
                            <div className="flex gap-6 text-base sm:text-sm">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => saveEdit(expense.id)}
                                className="text-[#1d1d1f] hover:text-[#3a3a3c] disabled:text-[#d2d2d7]"
                              >
                                저장
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="text-[#6e6e73] hover:text-[#1d1d1f]"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-baseline justify-between gap-6">
                            <div className="min-w-0">
                              <p className="break-words text-lg sm:text-base">{expense.description}</p>
                              <p className="mt-1 text-base text-[#6e6e73] sm:text-sm">{expense.date}</p>
                              <div className="mt-3 flex gap-5 text-base text-[#6e6e73] sm:text-sm">
                                <button
                                  type="button"
                                  onClick={() => startEdit(expense)}
                                  className="hover:text-[#1d1d1f]"
                                >
                                  수정
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeExpense(expense.id)}
                                  className="hover:text-[#1d1d1f]"
                                >
                                  삭제
                                </button>
                              </div>
                            </div>
                            <p className="numeric shrink-0 text-2xl font-medium sm:text-xl">
                              {currency.format(expense.amount)}
                            </p>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
