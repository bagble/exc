import adapter from '@sveltejs/adapter-node';
import {vitePreprocess} from '@sveltejs/vite-plugin-svelte';

export const ALLOWED_ORIGINS = [
    process.env.ORIGIN || 'http://localhost:5173', // 운영 환경, 개발 환경
];

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),
    kit: {
        adapter: adapter({
            out: 'build',
            precompress: false,
            envPrefix: ''
        }),
        csrf: {
            trustedOrigins: ALLOWED_ORIGINS
        }
    }
};

export default config;
