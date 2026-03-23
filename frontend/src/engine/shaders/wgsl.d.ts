/** Type declaration for Vite ?raw imports of WGSL shader files. */
declare module "*.wgsl?raw" {
  const source: string;
  export default source;
}
