import { useState } from "react";
import type { PromptTemplate } from "../lib/api";
import { fillPrompt, promptVariables, variableLabel } from "../lib/prompts";
import { Button, Field, Input, Modal } from "./ui";

/**
 * Preenche as variáveis de um prompt de tarefa antes de usá-lo. O texto final aparece enquanto se digita e só é
 * entregue com todas as variáveis preenchidas.
 */
export function TaskPromptDialog({
  prompt,
  onClose,
  onUse,
}: {
  prompt: PromptTemplate;
  onClose: () => void;
  onUse: (text: string) => void;
}) {
  const variables = promptVariables(prompt.content);
  const [values, setValues] = useState<Record<string, string>>({});
  const missing = variables.filter((v) => !values[v]?.trim());
  const text = fillPrompt(prompt.content, values);
  return (
    <Modal open onClose={onClose} title={prompt.name}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!missing.length) onUse(text);
        }}
      >
        {prompt.description && <p className="text-[12.5px] text-ink-400">{prompt.description}</p>}
        {variables.map((v, i) => (
          <Field key={v} label={variableLabel(v)}>
            <Input autoFocus={i === 0} value={values[v] ?? ""} onChange={(e) => setValues({ ...values, [v]: e.target.value })} />
          </Field>
        ))}
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-400">Texto que vai para o agente</div>
          <p className="whitespace-pre-wrap rounded-xl bg-ink-900 px-3 py-2.5 text-[13px] leading-relaxed text-ink-200">
            {text.split(/(\{\{[^}]+\}\})/).map((part, i) =>
              part.startsWith("{{") ? (
                <span key={i} className="rounded bg-warn/15 px-1 font-mono text-[12px] text-warn">
                  {part}
                </span>
              ) : (
                part
              ),
            )}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          {missing.length > 0 && (
            <span className="mr-auto text-[11.5px] text-ink-400">Preencha: {missing.map(variableLabel).join(", ")}</span>
          )}
          <Button type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={missing.length > 0}>
            Usar este texto
          </Button>
        </div>
      </form>
    </Modal>
  );
}
