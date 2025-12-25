// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { PJSe } from '$lib/server/loader/loader';

declare global {
    namespace App {
        // interface Error {}
        // interface Locals {}
        // interface PageData {}
        // interface PageState {}
        // interface Platform {}
    }
    let exchange: PJSe;
}

export {};
