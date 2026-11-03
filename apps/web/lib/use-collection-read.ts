"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccountApi } from "./account-client";

/** Keep slow reads alive across refreshes; cancel obsolete filters or owners. */
export function useCollectionRead<T>(
  path: string,
  revision = 0,
  delay = 0,
  onLoaded?: (data: T) => void,
) {
  const api = useAccountApi();
  const [data, setData] = useState<T>();
  const [dataPath, setDataPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const loaded = useRef(onLoaded);
  useEffect(() => {
    loaded.current = onLoaded;
  }, [onLoaded]);
  const inFlight = useRef<
    | {
        path: string;
        started: boolean;
        again: boolean;
        cancel: () => void;
      }
    | undefined
  >(undefined);
  useEffect(
    () => () => {
      inFlight.current?.cancel();
      inFlight.current = undefined;
    },
    [api],
  );
  useEffect(() => {
    if (inFlight.current?.path === path) {
      if (inFlight.current.started) inFlight.current.again = true;
      return;
    }
    inFlight.current?.cancel();
    const controller = new AbortController();
    const pending = {
      path,
      started: false,
      again: false,
      cancel: () => {
        clearTimeout(timer);
        controller.abort();
      },
    };
    inFlight.current = pending;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      pending.started = true;
      let succeeded = false;
      void api(path, "GET", undefined, undefined, controller.signal)
        .then((value: T) => {
          if (controller.signal.aborted) return;
          succeeded = true;
          setData(value);
          setDataPath(path);
          setLoading(false);
          loaded.current?.(value);
        })
        .catch((failure: Error) => {
          if (controller.signal.aborted) return;
          setError(failure.message);
          setLoading(false);
        })
        .finally(() => {
          if (inFlight.current !== pending) return;
          inFlight.current = undefined;
          // Do not turn an outage into an automatic retry loop.
          if (pending.again && succeeded) setRetry((n) => n + 1);
        });
    }, delay);
  }, [path, revision, retry, api, delay]);
  const reload = useCallback(async () => {
    setRetry((n) => n + 1);
  }, []);
  return { data, loading, error, reload, ready: dataPath === path };
}
