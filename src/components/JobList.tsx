import { useTranslation } from "react-i18next";
import type { Job } from "../types";
import { JobCard } from "./JobCard";

interface Props {
  jobs: Job[];
  onCancel: (jobId: string) => void;
}

export function JobList({ jobs, onCancel }: Props) {
  const { t } = useTranslation();

  if (jobs.length === 0) {
    return (
      <div className="p-8 text-center text-[0.9rem] text-slate-500">
        {t("jobs.emptyState")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} onCancel={onCancel} />
      ))}
    </div>
  );
}
