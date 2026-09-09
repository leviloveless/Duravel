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
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
