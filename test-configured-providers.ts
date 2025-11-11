import { getConfiguredProviders } from "@sylphx/code-core";

console.log("=== Testing getConfiguredProviders ===\n");

const cwd = process.cwd();
console.log("CWD:", cwd);

const providers = await getConfiguredProviders(cwd);
console.log("\nConfigured providers:", providers);
console.log("Count:", providers.length);

if (providers.length === 0) {
	console.log("\n❌ No providers detected as configured!");
} else {
	console.log("\n✅ Found configured providers:");
	providers.forEach((p) => console.log("  -", p));
}
