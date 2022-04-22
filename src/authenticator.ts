import { makeOrbitId, prepareSession, completeSessionSetup, SessionConfig, invoke } from "sdk";
import { WalletProvider } from "./walletProvider";

export async function defaultAuthn(
  wallet: WalletProvider,
  config?: Partial<SessionConfig>
): Promise<Authenticator> {
  let address = config?.address ?? (await wallet.getAddress());
  let chainId = config?.chainId ?? (await wallet.getChainId());
  return new Authenticator(wallet, {
    address,
    chainId,
    domain: config?.domain ?? window.location.hostname,
    service: config?.service ?? "kv",
    issuedAt: config?.issuedAt ?? new Date(Date.now()).toISOString(),
    notBefore: config?.notBefore,
    expirationTime:
      config?.expirationTime ??
      new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    actions: config?.actions ?? ["put", "get", "list", "del", "metadata"],
    orbitId: config?.orbitId ?? makeOrbitId(address, chainId),
  });
}

export class Authenticator {
  private session: Promise<string>;
  private orbitId: string;
  constructor(wallet: WalletProvider, config: SessionConfig) {
    this.session = Promise.resolve(config)
      .then(JSON.stringify)
      .then(prepareSession)
      .then(JSON.parse)
      .then(async (preparedSession) => ({
        ...preparedSession,
        signature: await wallet.signMessage(preparedSession.siwe),
      }))
      .then(JSON.stringify)
      .then(completeSessionSetup);
    this.orbitId = config.orbitId;
  }

  invocationHeaders = async (action: string, path: string ): Promise<HeadersInit> => this.session.then(session => invoke(session, path, action)).then(i => {console.log(i); return i}).then(JSON.parse);
  getOrbitId = (): string => this.orbitId;
}
