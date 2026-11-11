"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase, type Expense } from "@/lib/supabase";

const currency = new Intl.NumberFormat("ko-KR");

export default function Home() {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const total = useMemo(
    () => expenses.reduce((sum, item) => sum + item.amount, 0),
    [expenses],
  );

  async function loadExpenses() {
    const { data, error } = await supabase
      .from("expense")
      .select("id, created_at, date, amount, description")
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

    async function load() {
      const { data, error } = await supabase
        .from("expense")
        .select("id, created_at, date, amount, description")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (!active) {
        return;
      }

      if (error) {
        setMessage("지출 내역을 불러오지 못했습니다.");
      } else {
        setExpenses(data ?? []);
      }

      setLoading(false);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(amount.replaceAll(",", "").trim());

    if (!date || !description.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setMessage("날짜, 금액, 내용을 모두 올바르게 입력해 주세요.");
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase.from("expense").insert({
      date,
      amount: Math.round(parsed),
      description: description.trim(),
    });

    if (error) {
      setSaving(false);
      setMessage("저장하지 못했습니다. 다시 시도해 주세요.");
      return;
    }

    await loadExpenses();
    setDate("");
    setAmount("");
    setDescription("");
    setSaving(false);
    setMessage("저장되었습니다.");
  }

  const fieldClass =
    "h-14 w-full min-w-0 rounded-xl border-0 bg-[#f2f2f4] px-4 text-lg text-[#1d1d1f] outline-none transition-colors placeholder:text-[#a1a1a6] focus:bg-[#e8e8ed] sm:h-12 sm:text-base";

  return (
    <div className="min-h-full overflow-x-hidden bg-[#f5f5f7] px-5 py-10 text-[#1d1d1f] sm:px-8 sm:py-16">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-10 sm:gap-14">
        <header>
          <p className="text-base text-[#6e6e73] sm:text-sm">오늘도 가볍게 기록하기</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">나의 AI가계부</h1>
        </header>

        <main className="w-full rounded-[28px] bg-white px-5 py-7 sm:px-10 sm:py-10">
          <form className="flex flex-col gap-8 sm:gap-6" onSubmit={handleSubmit}>
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

            <button
              type="submit"
              disabled={saving}
              className="mt-1 h-14 w-full touch-manipulation rounded-xl bg-[#1d1d1f] text-lg font-medium text-white transition-colors hover:bg-[#3a3a3c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d1d1f] disabled:cursor-not-allowed disabled:bg-[#d2d2d7] sm:h-12 sm:text-base"
            >
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
                  <li
                    key={expense.id}
                    className="flex items-baseline justify-between gap-6 py-5"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-lg sm:text-base">{expense.description}</p>
                      <p className="mt-1 text-base text-[#6e6e73] sm:text-sm">{expense.date}</p>
                    </div>
                    <p className="numeric shrink-0 text-2xl font-medium sm:text-xl">
                      {currency.format(expense.amount)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
