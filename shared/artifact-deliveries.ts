import type { Artifact } from "./product.ts";

export interface ArtifactDelivery {
  key: string;
  latest: Artifact;
  previous: Artifact[];
}

// Only native documents carry a series identity. Matching filenames alone are
// insufficient: attachments, ordinary publications and other runs stay separate.
export function artifactDeliveries(artifacts: Artifact[]): ArtifactDelivery[] {
  const groups = new Map<string, Artifact[]>();
  for (const artifact of artifacts) {
    const key = artifact.document
      ? `${artifact.botId}/${artifact.runId}/${artifact.document.seriesId}`
      : artifact.id;
    const group = groups.get(key);
    if (group) group.push(artifact);
    else groups.set(key, [artifact]);
  }
  return Array.from(groups, ([key, group]) => {
    const sorted = group
      .slice()
      .sort(
        (a, b) =>
          (b.document?.revision || 0) - (a.document?.revision || 0) ||
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id),
      );
    return { key, latest: sorted[0], previous: sorted.slice(1) };
  });
}
