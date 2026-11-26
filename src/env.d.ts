/// <reference types="astro/client" />
/// <reference types="bun" />

declare namespace App {
    interface Locals {
        auth?: import('./lib/auth').AuthResult;
    }
}
