import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function packReviewHub(outputDirectory = "dist-release") {
  const output = path.resolve(outputDirectory);
  await mkdir(output, { recursive: true });

  console.log("Building @dev.fast/review-hub...");
  execFileSync("pnpm", ["--filter", "@dev.fast/review-hub", "build"], {
    stdio: "inherit",
  });

  console.log("Packing @dev.fast/review-hub...");
  execFileSync(
    "pnpm",
    ["--filter", "@dev.fast/review-hub", "pack", "--pack-destination", output],
    { stdio: "inherit" }
  );

  const pkgJson = JSON.parse(
    await readFile("apps/review-hub/package.json", "utf8")
  );

  const tarballName = `dev.fast-review-hub-${pkgJson.version}.tgz`;
  const tarballPath = path.join(output, tarballName);

  console.log(`Created deployable tarball at: ${tarballPath}`);

  return tarballPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packReviewHub().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
