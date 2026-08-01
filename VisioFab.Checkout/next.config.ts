import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // VisioFab.Checkout é hospedado como subpasta de VisioFab.Wms.Back por
  // restrição de acesso a diretórios do ambiente de desenvolvimento, mas é
  // um app Next.js independente (package.json/node_modules próprios, não
  // importa nada do backend). outputFileTracingRoot evita que o Next
  // infira a raiz do workspace a partir do lockfile do backend.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
