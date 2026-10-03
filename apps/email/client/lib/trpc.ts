import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@zero/server/trpc';
import superjson from 'superjson';
import { TRPC_URL } from './backend-url';
import { isSafeRelativePath } from './safe-url';

const getUrl = () => TRPC_URL;

export const api = createTRPCClient<AppRouter>({
    links: [
        httpBatchLink({
            maxItems: 1,
            url: getUrl(),
            transformer: superjson,
            fetch: (url, options) =>
                fetch(url, { ...options, credentials: 'include' }).then((res) => {
                    if (typeof window !== 'undefined') {
                        const currentPath = new URL(window.location.href).pathname;
                        const redirectPath = res.headers.get('X-Zero-Redirect');
                        // The header names an in-app route; anything that is not a same-origin path is ignored.
                        if (isSafeRelativePath(redirectPath) && redirectPath !== currentPath) {
                            window.location.href = redirectPath;
                            res.headers.delete('X-Zero-Redirect');
                        }
                    }
                    return res;
                }),
        }),
    ],
}); 