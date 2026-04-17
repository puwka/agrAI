/** На Vercel для next-auth v4 выставляем корректный origin для preview/prod */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.VERCEL !== "1") return;

  if (process.env.VERCEL_URL) {
    if (process.env.VERCEL_ENV === "preview") {
      process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_URL}`;
    } else if (!process.env.NEXTAUTH_URL?.trim()) {
      /* прод без NEXTAUTH_URL в Vercel — подставляем origin деплоя */
      process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_URL}`;
    }
  }

}
