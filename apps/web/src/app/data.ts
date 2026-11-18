import { createElement, createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../infrastructure/db/db';
import { analyzeRisk, riskScore } from '../core/domain/risk';
import { identityKey } from '../core/domain/identity';
import { useNetwork } from './context';
import type { AgentDevice, BaselineRec, DeviceRec, Finding } from '../core/domain/types';

export const recToAgent = (d: DeviceRec): AgentDevice => ({
  ipAddress: d.ipAddress, macAddress: d.macAddress ?? null, macRandomized: d.macRandomized, hostname: d.hostname ?? null, vendor: d.vendor ?? null,
  deviceType: d.deviceType, osGuess: d.osGuess ?? null, classificationConfidence: d.classificationConfidence, status: d.status, pingMs: d.pingMs ?? null,
  openPorts: d.openPorts, httpTitle: d.httpTitle ?? null, source: d.source, note: d.note ?? null,
});

export interface NetData { loading: boolean; devices: DeviceRec[]; baseline: BaselineRec[]; findings: Finding[]; score: number | null; online: number; newDevices: number }
const Ctx = createContext<NetData>({ loading: true, devices: [], baseline: [], findings: [], score: null, online: 0, newDevices: 0 });
export const useNetData = () => useContext(Ctx);

/** Truy vấn thiết bị/baseline và tính Finding MỘT lần cho toàn app (Header, Overview, Security dùng chung). */
export function NetDataProvider({ children }: { children: ReactNode }) {
  const { current } = useNetwork();
  const devices = useLiveQuery(() => (current ? db.devices.where('networkId').equals(current.id).toArray() : []), [current?.id]);
  const baseline = useLiveQuery(() => (current ? db.baselines.where('networkId').equals(current.id).toArray() : []), [current?.id]);
  const value = useMemo<NetData>(() => {
    const d = devices ?? []; const b = baseline ?? [];
    const findings = analyzeRisk(d.map(recToAgent), { identityKeyOf: identityKey, baselineKeys: new Set(b.map((x) => x.deviceIdentityKey)) });
    const known = new Set(b.map((x) => x.deviceIdentityKey));
    return {
      loading: devices === undefined || baseline === undefined, devices: d, baseline: b, findings, score: d.length ? riskScore(findings) : null,
      online: d.filter((x) => x.status === 'online').length, newDevices: b.length ? d.filter((x) => !known.has(x.identityKey)).length : 0,
    };
  }, [devices, baseline]);
  return createElement(Ctx.Provider, { value }, children);
}
