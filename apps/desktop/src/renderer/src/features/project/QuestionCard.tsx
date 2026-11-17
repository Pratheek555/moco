import { memo, useId, useRef, useState } from "react";
import type { Question } from "@moco/agent/types";
import type { QuestionBlock } from "../../conversation.ts";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Input } from "../../components/ui/input.tsx";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { chooseOption, questionAnswers } from "./question-answers.ts";

export const QuestionCard = memo(function QuestionCard({ projectId, block, onAnswered }: { projectId: string; block: QuestionBlock; onAnswered: () => void }) {
  const uid = useId();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState("");
  const answered = block.answers !== undefined;
  const disabled = answered || submitted;
  const answers = questionAnswers(block.questions, selected, other);
  const valid = block.questions.every(question => !!answers[question.question]?.trim());

  function choose(question: Question, label: string) {
    if (disabled) return;
    setSelected(old => ({ ...old, [question.question]: chooseOption(question, old[question.question] ?? [], label) }));
    if (!question.multiSelect) setOther(old => ({ ...old, [question.question]: "" }));
  }
  return <form aria-label="Agent question" className="min-w-0 space-y-4 rounded-xl border border-primary/30 bg-card p-5 shadow-xs" onSubmit={event => {
    event.preventDefault();
    if (!valid || disabled || sending.current) return;
    sending.current = true; setSubmitted(true); setError("");
    void api.answer(projectId, block.questionId, answers).then(onAnswered).catch(error => { setError(errorMessage(error).split(/\n\s+at\s/)[0]!); setSubmitted(false); sending.current = false; });
    // Remain disabled after IPC resolves. Only a persisted answer event confirms the answer.
  }}>
    {!answered && <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="size-2 rounded-full bg-warning" />Waiting for your answer</p>}
    {block.questions.map((question, qi) => <fieldset key={`${qi}:${question.question}`} disabled={disabled} className="min-w-0 space-y-3" onKeyDown={event => {
      const target = event.target as HTMLElement;
      if (disabled || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || target.matches("input, textarea, [contenteditable=true]")) return;
      const index = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
      const option = question.options[index];
      if (option) { event.preventDefault(); choose(question, option.label); document.getElementById(`${uid}-${qi}-${index}`)?.focus(); }
    }}>
      <legend className="mb-2 w-full space-y-2 text-sm font-medium [overflow-wrap:anywhere] select-text">
        {!answered && question.header && <Badge variant="secondary" className="max-w-full whitespace-normal">{question.header}</Badge>}
        <span className="block">{question.question}</span>
      </legend>
      {answered ? <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere] select-text">You answered: {block.answers?.[question.question]}</p> : <>
        {question.multiSelect ? <div className="space-y-2">{question.options.map((option, oi) => <label key={`${oi}:${option.label}`} htmlFor={`${uid}-${qi}-${oi}`} className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
          <Checkbox id={`${uid}-${qi}-${oi}`} className="mt-1" aria-label={option.label} aria-describedby={option.description ? `${uid}-${qi}-${oi}-description` : undefined} checked={(selected[question.question] ?? []).includes(option.label)} disabled={disabled} onCheckedChange={() => choose(question, option.label)} />
          <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{option.label}{option.description && <span id={`${uid}-${qi}-${oi}-description`} className="mt-1 block text-[13px] text-muted-foreground">{option.description}</span>}</span>
        </label>)}</div> : <RadioGroup value={selected[question.question]?.[0] ?? ""} disabled={disabled} aria-label={question.question} className="gap-2" onValueChange={value => choose(question, value)}>
          {question.options.map((option, oi) => <label key={`${oi}:${option.label}`} htmlFor={`${uid}-${qi}-${oi}`} className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <RadioGroupItem id={`${uid}-${qi}-${oi}`} value={option.label} className="mt-1" aria-label={option.label} aria-describedby={option.description ? `${uid}-${qi}-${oi}-description` : undefined} />
            <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{option.label}{option.description && <span id={`${uid}-${qi}-${oi}-description`} className="mt-1 block text-[13px] text-muted-foreground">{option.description}</span>}</span>
          </label>)}
        </RadioGroup>}
        <Input aria-label={`Other: ${question.question}`} placeholder="Something else" value={other[question.question] ?? ""} disabled={disabled} onChange={event => {
          setOther(old => ({ ...old, [question.question]: event.target.value }));
          if (!question.multiSelect) setSelected(old => ({ ...old, [question.question]: [] }));
        }} />
      </>}
    </fieldset>)}
    {error && <p role="alert" className="text-[13px] text-destructive [overflow-wrap:anywhere] select-text">{error} Try again.</p>}
    {!answered && <Button type="submit" size="sm" disabled={!valid || submitted}>{submitted && <Spinner aria-hidden="true" />}Continue</Button>}
  </form>;
}, (before, after) => before.projectId === after.projectId && before.block.id === after.block.id && before.onAnswered === after.onAnswered &&
  Object.keys(before.block.answers ?? {}).length === Object.keys(after.block.answers ?? {}).length &&
  (before.block.answers === undefined) === (after.block.answers === undefined) &&
  Object.entries(before.block.answers ?? {}).every(([key, value]) => after.block.answers?.[key] === value));
