import { PasswordGate } from "@/components/storage/password-gate";
import { StorageDashboard } from "@/components/storage/storage-dashboard";
import { isAuthenticated } from "@/lib/auth";
import { getBucketLabel, listEntries } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function Home() {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return <PasswordGate />;
  }

  const [snapshot, bucket] = await Promise.all([listEntries(), Promise.resolve(getBucketLabel())]);

  return (
    <StorageDashboard
      initialSnapshot={snapshot}
      bucketName={bucket}
    />
  );
}
