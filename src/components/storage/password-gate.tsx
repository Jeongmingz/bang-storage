"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { toast } from "sonner";

import { authenticate } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PIN_LENGTH = 4;

export function PasswordGate() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSubmitted = useRef<string | null>(null);

  const ready = value.length === PIN_LENGTH;

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = event.target.value.replace(/\D+/g, "").slice(0, PIN_LENGTH);
    setValue(sanitized);
    setError(null);
  };

  const submitPassword = useCallback(
    (password: string) => {
      if (password.length !== PIN_LENGTH || pending) return;

      lastSubmitted.current = password;
      const formData = new FormData();
      formData.set("password", password);

      startTransition(() => {
        authenticate(formData).then((result) => {
          if (result.success) {
            toast.success(result.message ?? "잠금 해제 완료");
            setValue("");
            router.refresh();
          } else {
            setError(result.message);
            toast.error(result.message);
            setValue("");
            lastSubmitted.current = null;
          }
        });
      });
    },
    [pending, router],
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitPassword(value);
  };

  useEffect(() => {
    if (ready && !pending && lastSubmitted.current !== value) {
      submitPassword(value);
    }
  }, [ready, pending, value, submitPassword]);

  const maskedDigits = Array.from({ length: PIN_LENGTH }).map((_, index) => value[index] ?? "•");

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-gradient-to-br from-pink-100 via-rose-50 to-pink-200 px-6 py-20 text-foreground">
      <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden>
        <div className="absolute -left-1/3 top-[-15%] h-[30rem] w-[30rem] rounded-full bg-pink-400/30 blur-[160px]" />
        <div className="absolute right-[-20%] top-[-10%] h-[24rem] w-[24rem] rounded-full bg-rose-500/30 blur-[160px]" />
      </div>

      <div className="relative text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">지현아 반가워.</h1>
        <p className="mt-3 text-sm text-muted-foreground">우리 둘만의 작은 금고, 비밀 숫자만 알면 바로 열려요 💜</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md space-y-6 rounded-3xl border border-pink-200/80 bg-white/90 p-8 shadow-[0_35px_120px_rgba(244,114,182,0.35)]"
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-dashed border-rose-200/60 bg-gradient-to-r from-pink-300/30 via-rose-100/40 to-pink-200/30 p-5 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Private PIN</p>
            <div className="mt-3 flex justify-center gap-3 font-mono text-3xl">
              {maskedDigits.map((digit, index) => (
                <span
                  key={`${digit}-${index}`}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-foreground shadow-inner shadow-black/30"
                >
                  {digit}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">숫자 {PIN_LENGTH}자리만 기억나면 돼</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium text-rose-500">
              비밀번호 입력
            </Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={visible ? "text" : "password"}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={PIN_LENGTH}
                value={value}
                onChange={handleInputChange}
                placeholder={`숫자 ${PIN_LENGTH}자리`}
                required
                disabled={pending}
                className="rounded-2xl border-2 border-transparent bg-gradient-to-r from-pink-200/60 via-white/60 to-rose-100/70 text-center text-xl tracking-[0.4em] text-foreground shadow-inner shadow-rose-200/80 focus-visible:border-pink-400"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute inset-y-0 right-2 my-auto rounded-full bg-rose-100/80 text-rose-500"
                onClick={() => setVisible((prev) => !prev)}
                disabled={pending}
                aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
              >
                {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">네 자리 채우면 자동으로 문이 열립니다.</p>
        </div>

        {error ? (
          <p className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-3 text-sm text-rose-400">
          <span className="flex-1 text-left">숫자만 눌러주면 바로 열어줄게.</span>
          <Button
            type="submit"
            variant="secondary"
            size="icon"
            className="bg-rose-500 text-white hover:bg-rose-400"
            disabled={pending || !ready}
          >
            {pending ? "..." : "→"}
          </Button>
        </div>
      </form>
    </div>
  );
}
