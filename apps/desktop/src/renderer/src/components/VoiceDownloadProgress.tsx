import { Progress } from "@/components/ui/progress";
import type { VoiceModelStatus } from "../../../shared/api.ts";

const megabytes = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function VoiceDownloadProgress({ model }: { model: VoiceModelStatus }) {
  const known = model.totalBytes !== undefined && model.totalBytes > 0 && model.downloadedBytes !== undefined;
  const total = model.totalBytes ?? 0;
  const downloaded = Math.min(total, Math.max(0, model.downloadedBytes ?? 0));
  const mb = (bytes: number) => `${megabytes.format(bytes / 1_000_000)} MB`;
  const label = known ? `${mb(downloaded)} of ${mb(total)} downloaded · ${mb(total - downloaded)} left` : undefined;
  return <div className="space-y-2">
    <Progress aria-label={`${model.name} download progress`} aria-valuetext={label}
      value={known ? downloaded / total * 100 : null} />
    {label && <p className="text-xs text-muted-foreground tabular-nums">{label}</p>}
  </div>;
}
