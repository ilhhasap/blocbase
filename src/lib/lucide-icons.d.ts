declare module "lucide-react/dynamicIconImports.mjs" {
  const imports: Record<string, () => Promise<unknown>>;
  export default imports;
}
