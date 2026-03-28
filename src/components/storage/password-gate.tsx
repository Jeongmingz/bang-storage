"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
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

  useEffect(() => {
    const htmlOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = htmlOverflow;
      document.body.style.overflow = bodyOverflow;
    };
  }, []);

  const ready = value.length === PIN_LENGTH;

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = event.target.value.replace(/\D+/g, "").slice(0, PIN_LENGTH);
    setValue(sanitized);
    setError(null);
  };

  const submitPassword = (password: string) => {
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
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitPassword(value);
  };

  useEffect(() => {
    if (ready && !pending && lastSubmitted.current !== value) {
      submitPassword(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pending, value]);

  const maskedDigits = Array.from({ length: PIN_LENGTH }).map((_, index) => value[index] ?? "•");

  return (
    <div className="fixed inset-0 flex min-h-screen flex-col-reverse overflow-hidden bg-gradient-to-br from-pink-100 via-rose-50 to-pink-200 text-foreground lg:flex-row">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-1/4 top-[-10%] h-[28rem] w-[28rem] rounded-full bg-pink-300/30 blur-[160px]" />
        <div className="absolute bottom-[-15%] right-[-10%] h-[26rem] w-[26rem] rounded-full bg-rose-400/40 blur-[160px]" />
      </div>

      <div className="relative flex flex-1 flex-col gap-4 px-5 py-6 sm:px-9 lg:px-14">
        <div className="mx-auto mt-4 w-full max-w-md space-y-3 text-left lg:ml-0 lg:mt-auto lg:max-w-xl">
          <p className="text-xs uppercase tracking-[0.35em] text-rose-400">Private Vault</p>
          <h1 className="text-[34px] font-semibold leading-tight tracking-tight sm:text-[42px]">지현아 반가워.</h1>
          <p className="text-sm text-muted-foreground">
            우리 둘만의 작은 금고예요. 휴대폰에서도 바로 열 수 있도록 비밀번호 패드를 한쪽에 고정했어요.
          </p>
        </div>
        <div className="mb-auto hidden text-xs text-rose-500/70 lg:block">네 자리 기억나면 언제든 바로 열리니까 걱정 마.</div>
      </div>

      <aside className="relative flex h-full w-full max-w-full flex-col border-white/30 bg-white/95 px-4 py-6 shadow-[0_28px_100px_rgba(244,114,182,0.28)] backdrop-blur-xl sm:px-6 lg:max-w-md lg:border-l lg:rounded-l-[44px]">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-rose-400">
          <span>Access Keypad</span>
          <span>{ready ? "Ready" : `${PIN_LENGTH}-digit`}</span>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-dashed border-rose-200/60 bg-gradient-to-r from-pink-300/25 via-rose-100/40 to-pink-200/30 p-4 text-center shadow-inner shadow-rose-100/60">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Private PIN</p>
            <div className="mt-2 flex justify-center gap-2 font-mono text-2xl">
              {maskedDigits.map((digit, index) => (
                <span
                  key={`${digit}-${index}`}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/75 text-foreground shadow-inner shadow-black/10"
                >
                  {digit}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">숫자 {PIN_LENGTH}자리만 기억나면 돼</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
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
                  className="rounded-2xl border border-transparent bg-gradient-to-r from-pink-200/60 via-white/70 to-rose-100/70 text-center text-lg tracking-[0.35em] text-foreground shadow-inner shadow-rose-200/70 focus-visible:border-pink-400"
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
              <p className="text-[11px] text-muted-foreground">네 자리 채우면 자동으로 문이 열립니다.</p>
            </div>

            {error ? (
              <p className="rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
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
      </aside>
    </div>
  );
}
