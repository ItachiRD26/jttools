// ─────────────────────────────────────────────
//  UBICACIÓN: next.config.ts  (raíz del proyecto)
//  QUÉ HACE:  Configuración de Next.js
// ─────────────────────────────────────────────
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite que las imágenes de Etsy se muestren con next/image
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.etsystatic.com",
      },
      {
        protocol: "https",
        hostname: "**.etsystatic.com",
      },
    ],
  },

  // Variables de entorno que se exponen al cliente (solo NEXT_PUBLIC_*)
  // Las que no tienen NEXT_PUBLIC_ solo existen en el servidor — no hace falta declararlas aquí.

  // Redireccionamientos útiles
  async redirects() {
    return [
      {
        source: "/login",
        destination: "/auth",
        permanent: true,
      },
      {
        source: "/signup",
        destination: "/auth",
        permanent: true,
      },
      {
        source: "/api-docs",
        destination: "/docs",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;