/// <reference types="vite/client" />

declare module '*.kml?raw' {
  const content: string;
  export default content;
}

declare module '*.kml' {
  const content: string;
  export default content;
}
