import { readSupabaseSession } from "./auth/server";

/** The application depends on its session contract, not provider SDK details. */
export function auth() {
  return {
    api: {
      getSession: async (_input?: { headers: Headers }) => {
        void _input;
        return readSupabaseSession();
      },
    },
  };
}
