"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { EyeIcon, EyeOffIcon, LockIcon } from "lucide-react";
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
          toast.success(result.message ?? "로그인되었습니다.");
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

  const maskedDigits = Array.from({ length: PIN_LENGTH }).map((_, index) => value[index] ?? "");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[360px] space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-md border border-border bg-muted">
            <LockIcon className="size-4 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground">Bang Storage</h1>
            <p className="text-sm text-muted-foreground">계속하려면 비밀번호를 입력하세요.</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex justify-center gap-2">
            {maskedDigits.map((digit, index) => (
              <span
                key={index}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted font-mono text-base text-foreground"
              >
                {digit ? "•" : ""}
              </span>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                비밀번호 (4자리)
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
                  placeholder="••••"
                  required
                  disabled={pending}
                  autoFocus
                  className="pr-9 text-center tracking-[0.4em]"
                />
                <button
                  type="button"
                  onClick={() => setVisible((prev) => !prev)}
                  disabled={pending}
                  aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
                  className="absolute inset-y-0 right-2 my-auto flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={pending || !ready}>
              {pending ? "확인 중..." : "로그인"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
