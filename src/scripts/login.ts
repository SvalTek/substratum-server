const form = document.querySelector<HTMLFormElement>('#login-form');
const password = document.querySelector<HTMLInputElement>('#password');
const error = document.querySelector<HTMLParagraphElement>('#login-error');

form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!password || !error) return;
    error.textContent = '';
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ password: password.value }),
        });
        if (!response.ok) throw new Error(response.status === 401 ? 'Password incorrect, or sign-in temporarily locked.' : 'Unable to sign in.');
        window.location.assign('/');
    } catch (reason) {
        error.textContent = reason instanceof Error ? reason.message : 'Unable to sign in.';
    } finally {
        if (button) button.disabled = false;
    }
});
