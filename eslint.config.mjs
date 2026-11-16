import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Lint da lógica TypeScript (núcleo e web/src/lib), conforme a seção 9 de docs/CODIGO.md.
// Componentes React ficam de fora: seguem o guia visual e não estas regras.
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  {
    files: ["core/**/*.ts", "web/src/lib/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { project: ["./web/tsconfig.json"], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "never" }],
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
      // Implementações de contratos assíncronos (Tool.run, handlers MCP) nem sempre aguardam algo;
      // promises esquecidas continuam cobertas por no-floating-promises e no-misused-promises.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // Os testes leem respostas das rotas (`body` sem tipo), acessam o que acabaram de criar e montam
    // objetos parciais como entrada: checar cada campo só tornaria as asserções mais longas.
    files: ["core/tests/**/*.ts", "web/src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
