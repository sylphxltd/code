import { loadAIConfig } from "@sylphx/code-core";
import { getProvider } from "./packages/code-core/src/ai/providers/index.js";

console.log("=== Testing OpenRouter Configuration ===\n");

// Load config
const result = await loadAIConfig();

console.log("1. Config load result:");
if (result.success) {
	console.log("   ✅ Success");
	console.log("   Config:", JSON.stringify(result.data, null, 2));
} else {
	console.log("   ❌ Failed:", result.error);
	process.exit(1);
}

const config = result.data;

// Check openrouter config
console.log("\n2. OpenRouter config from settings:");
const openrouterConfig = config.providers?.openrouter;
console.log("   Config object:", openrouterConfig);
console.log("   apiKey present:", !!openrouterConfig?.apiKey);
console.log("   apiKey value:", openrouterConfig?.apiKey);

// Get provider and check isConfigured
console.log("\n3. Provider isConfigured check:");
const provider = getProvider("openrouter");
console.log("   Provider:", provider.name);

const schema = provider.getConfigSchema();
console.log("   Config schema:", schema);

if (openrouterConfig) {
	const isConfigured = provider.isConfigured(openrouterConfig);
	console.log("   isConfigured():", isConfigured);

	// Debug hasRequiredFields
	const requiredFields = schema.filter((f) => f.required);
	console.log(
		"   Required fields:",
		requiredFields.map((f) => f.key),
	);

	for (const field of requiredFields) {
		const value = openrouterConfig[field.key];
		console.log(`   - ${field.key}:`, {
			value,
			type: typeof value,
			isUndefined: value === undefined,
			isEmpty: value === "",
		});
	}
} else {
	console.log("   ❌ No openrouter config found!");
}

console.log("\n✅ Test complete!");
