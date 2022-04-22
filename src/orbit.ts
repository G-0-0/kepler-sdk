import { Authenticator } from "./authenticator";
import { Blob } from "./blob";
import { generateHostSIWEMessage, host, HostConfig } from "sdk";
import { KV } from "./kv";
import { WalletProvider } from "./walletProvider";

if (typeof fetch === "undefined") {
  const fetch = require("node-fetch");
}

/**
 * A connection to an orbit in a Kepler instance.
 *
 * This class provides methods for interacting with an orbit. Construct an instance of this class using {@link Kepler.orbit}.
 */
export class OrbitConnection {
  private orbitId: string;
  private kv: KV;

  /** @ignore */
  constructor(keplerUrl: string, authn: Authenticator) {
    this.orbitId = authn.getOrbitId();
    this.kv = new KV(keplerUrl, authn);
  }

  /** Get the id of the connected orbit.
   *
   * @returns The id of the connected orbit.
   */
  id(): string {
    return this.orbitId;
  }

  /** Store an object in the connected orbit.
   *
   * A {@link https://developer.mozilla.org/en-US/docs/Web/API/Blob | Blob} or Blob-like
   * (e.g. {@link https://developer.mozilla.org/en-US/docs/Web/API/File | File}), can be stored without
   * any additional information:
   * ```ts
   * let blob: Blob = new Blob(['value'], {type: 'text/plain'});
   * await orbitConnection.put('a', blob);
   *
   * let file: File = filelist[0];
   * await orbitConnection.put('b', file);
   * ```
   *
   * This method can also implicitly convert some non-Blob-like values to Blobs if supplied with the
   * MIME type in the optional request parameters:
   * ```ts
   * await orbitConnection.put('c', 'value', {type: 'text/plain'})
   * await orbitConnection.put('d', {x: 10}, {type: 'application/json'})
   * ```
   * The supported MIME types are `text/*` and `application/json`.
   *
   * @param key The key with which the object is indexed.
   * @param value The object to be stored.
   * @param req Optional request parameters.
   * @returns A {@link Response} without the `data` property.
   */
  async put(key: string, value: any, req?: Request): Promise<Response> {
    const request = req || {};
    const type = request.type || "unknown";

    const transformResponse = (response: FetchResponse) => {
      const { ok, status, statusText, headers } = response;
      return { ok, status, statusText, headers };
    };

    const blob: Blob = type.startsWith("text/")
      ? new Blob([value], { type })
      : type === "application/json"
      ? new Blob([JSON.stringify(value)], { type })
      : value;

    // @ts-ignore
    return this.kv.put(key, blob, {}).then(transformResponse);
  }

  /** Retrieve an object from the connected orbit.
   *
   * Objects that are stored with supported MIME types will be automatically converted from
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/Blob | Blob} on retrieval:
   * ```ts
   * await orbitConnection.put('string', 'value', {type: 'text/plain'});
   * await orbitConnection.put('json', {x: 10}, {type: 'application/json'});
   * let blob = new Blob(['value'], {type: 'text/plain'});
   * await orbitConnection.put('blob', blob);
   *
   * let stringData: string = await orbitConnection.get('string').then(({ data }) => data);
   * let jsonData: {x: number} = await orbitConnection.get('json').then(({ data }) => data);
   * let blobData: string = await orbitConnection.get('blob').then(({ data }) => data);
   * ```
   * The supported MIME types for automatic conversion are `text/*` and `application/json`.
   *
   * If the object has any other MIME type, or the MIME type was not stored, then a Blob will be
   * returned:
   * ```ts
   * let blob = new Blob([new ArrayBuffer(8)], {type: 'image/gif'});
   * await orbitConnection.put('gif', blob);
   * let gifData: Blob = await orbitConnection.get('gif').then(({ data }) => data);
   * ```
   *
   * Alternatively you can retrieve any object as a
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream | ReadableStream},
   * by supplying request parameters:
   * ```ts
   * let data = await orbitConnection.get('key', {streamBody: true}).then(
   *   ({ data }: { data?: ReadableStream }) => {
   *     // consume the stream
   *   }
   * );
   * ```
   *
   * @param key The key with which the object is indexed.
   * @param req Optional request parameters.
   * @returns A {@link Response} with the `data` property (see possible types in the documentation above).
   */
  async get(key: string, req?: Request): Promise<Response> {
    const request = req || {};
    const streamBody = request.streamBody || false;

    const transformResponse = async (response: FetchResponse) => {
      const { ok, status, statusText, headers } = response;
      const type: string | null = headers.get("content-type");
      const data = !ok
        ? undefined
        : streamBody
        ? response.body
        : await // content type was not stored, let the caller decide how to handle the blob
          (!type
            ? response.blob()
            : type.startsWith("text/")
            ? response.text()
            : type === "application/json"
            ? response.json()
            : response.blob());
      return { ok, status, statusText, headers, data };
    };

    return this.kv.get(key).then(transformResponse);
  }

  /** Delete an object from the connected orbit.
   *
   * @param key The key with which the object is indexed.
   * @param req Optional request parameters (unused).
   * @returns A {@link Response} without the `data` property.
   */
  async delete(key: string, req?: Request): Promise<Response> {
    const transformResponse = (response: FetchResponse) => {
      const { ok, status, statusText, headers } = response;
      return { ok, status, statusText, headers };
    };

    return this.kv.del(key).then(transformResponse);
  }

  /** List objects in the connected orbit.
   *
   * The list of keys is retrieved as a list of strings:
   * ```ts
   * let keys: string[] = await orbitConnection.list().then(({ data }) => data);
   * ```
   * Optionally, you can retrieve the list of objects as a
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream | ReadableStream},
   * by supplying request parameters:
   * ```ts
   * let data = await orbitConnection.list("", {streamBody: true}).then(
   *   ({ data }: { data?: ReadableStream }) => {
   *     // consume the stream
   *   }
   * );
   * ```
   *
   * @param prefix The prefix that the returned keys should have.
   * @param req Optional request parameters.
   * @returns A {@link Response} with the `data` property as a string[].
   */
  async list(prefix: string = "", req?: Request): Promise<Response> {
    const request = req || {};
    const streamBody = request.streamBody || false;

    const transformResponse = async (response: FetchResponse) => {
      const { ok, status, statusText, headers } = response;
      const data = !ok
        ? undefined
        : streamBody
        ? response.body
        : await response.json();

      return { ok, status, statusText, headers, data };
    };

    return this.kv.list(prefix).then(transformResponse);
  }

  /** Retrieve metadata about an object from the connected orbit.
   *
   * @param key The key with which the object is indexed.
   * @param req Optional request parameters (unused).
   * @returns A {@link Response} without the `data` property.
   */
  async head(key: string, req?: Request): Promise<Response> {
    const transformResponse = (response: FetchResponse) => {
      const { ok, status, statusText, headers } = response;
      return { ok, status, statusText, headers };
    };

    return this.kv.head(key).then(transformResponse);
  }
}

/** Optional request parameters.
 *
 * Not all options are applicable on every {@link OrbitConnection} method. See the documentation
 * of each method to discover what options are supported.
 */
export type Request = {
  /** The MIME type of the requested object. */
  type?: string;
  /** Request to receive the data as a {@link https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream | ReadableStream}. */
  streamBody?: boolean;
};

/** Response from kepler requests.
 *
 * The methods on {@link OrbitConnection} return a Response that may have `data` property. See the
 * documentation of each method to discover whether a method will return data and what type you
 * can expect.
 */
export type Response = {
  /** Whether the request was successful or not. */
  ok: boolean;
  /** The HTTP status code of the response from Kepler. */
  status: number;
  /** The textual representation of the HTTP status of the response from Kepler. */
  statusText: string;
  /** Metadata about the object and the request. */
  headers: Headers;
  /** The body of the response from Kepler. */
  data?: any;
};

type FetchResponse = globalThis.Response;

export const hostOrbit = async (wallet: WalletProvider, keplerUrl: string, orbitId: string, domain: string = window.location.hostname): Promise<Response> => {
  const address = await wallet.getAddress();
  const chainId = await wallet.getChainId();
  const issuedAt = new Date(Date.now()).toISOString();
  const peerId = await fetch(keplerUrl + '/peer/generate').then(res => res.text());
  const config: HostConfig = {
    address, chainId, domain, issuedAt, orbitId, peerId
  };
  const siwe = generateHostSIWEMessage(JSON.stringify(config));
  const signature = await wallet.signMessage(siwe);
  const hostHeaders = host(JSON.stringify({siwe, signature}));
  return fetch(keplerUrl + '/delegate', { method: "POST", headers: JSON.parse(hostHeaders) }).then(({ ok, status, statusText, headers }) => ({ ok, status, statusText, headers }));
};