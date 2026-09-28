// eslint-config-next 16.x ships native flat config (arrays of flat config
// objects), so it is imported directly rather than through the eslintrc
// FlatCompat bridge: FlatCompat expects an eslintrc-shaped object and fails
// schema validation when handed a flat config array.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// Next.js core-web-vitals + TypeScript rules (RSC / hooks / a11y).
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    // Apple/ holds iOS integration drafts that are copied into the Capacitor
    // project, not compiled here.
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "Apple/**"],
  },
  {
    // The codebase marks deliberately unused parameters with a leading "_"
    // (stub signatures, positional callbacks). Honour that convention.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default eslintConfig;
