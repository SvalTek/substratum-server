// @ts-check
import { defineConfig } from 'astro/config';
import bun from "@igloczek/astro-bun-adapter";
import vue from '@astrojs/vue';

// https://astro.build/config
export default defineConfig({
    output: "server",
    adapter: bun({ mode: "standalone", idleTimeout: 60 }),
    integrations: [vue()],
    server: {
        host: process.env.HOST || '127.0.0.1',
        port: Number(process.env.PORT || 4321),
    },
    security: {
        csp: {
            directives: [
                "default-src 'self'",
                "connect-src 'self'",
                "img-src 'self' data: blob:",
                "font-src 'self'",
                "object-src 'none'",
                "base-uri 'self'",
                "frame-ancestors 'none'",
                "form-action 'self'",
            ],
        },
    },
    vite: {
        ssr: {
            external: ['bun:sqlite', 'webluabridge'],
            resolve: {
                conditions: ['bun'],
                externalConditions: ['bun'],
            },
        },
        build: { rolldownOptions: { external: ['webluabridge'] } },
    },
});
