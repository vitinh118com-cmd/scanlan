export type Confidence = 'low' | 'medium' | 'high';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface PortInfo { port: number; protocol: string; service: string; state: string }

/** DTO do Agent trả về (xem docs/agent-protocol.md). */
export interface AgentDevice {
  ipAddress: string;
  macAddress?: string | null;
  macRandomized: boolean;
  hostname?: string | null;
  vendor?: string | null;
  deviceType: string;
  osGuess?: string | null;
  classificationConfidence: Confidence;
  status: 'online' | 'offline';
  pingMs?: number | null;
  openPorts: PortInfo[];
  httpTitle?: string | null;
  source: string[];
  note?: string | null;
}

export interface NetworkRec {
  id: string; networkKey: string; label: string; interfaceLabel: string; subnetCidr: string; gateway: string;
  firstSeenAt: number; lastSeenAt: number; createdAt: number; updatedAt: number;
}

export type ScanStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';

export interface ScanSessionRec {
  id: string; networkId: string; startedAt: number; completedAt?: number; status: ScanStatus; profile: string; cidr: string;
  totalTargets: number; processedTargets: number; devicesFound: number; agentVersion: string; appVersion: string; errorSummary?: string;
}

export interface DeviceRec {
  id: string; networkId: string; identityKey: string; ipAddress: string; macAddress?: string; macRandomized: boolean;
  hostname?: string; vendor?: string; deviceType: string; osGuess?: string; classificationConfidence: Confidence;
  status: 'online' | 'offline'; openPorts: PortInfo[]; httpTitle?: string; pingMs?: number;
  firstSeenAt: number; lastSeenAt: number; note?: string; tags: string[]; source: string[]; updatedAt: number;
}

export interface ObservationRec {
  id: string; scanSessionId: string; deviceId: string; networkId: string; observedAt: number;
  ipAddress: string; macAddress?: string; pingMs?: number; status: string; ports: PortInfo[]; protocols: string[]; evidence: string[];
}

export interface BaselineRec { id: string; networkId: string; deviceIdentityKey: string; approvedAt: number; approvedLabel: string; note?: string }

export interface AssetRec {
  id: string; networkId?: string; deviceId?: string; assetName: string; assetType: string; owner?: string; location?: string;
  tags: string[]; note?: string; ipAddress?: string; macAddress?: string; vendor?: string; createdAt: number; updatedAt: number;
}

export interface WifiSnapshotRec {
  id: string; capturedAt: number; interfaceLabel: string; ssid?: string; bssid?: string; rssiDbm?: number; signalQuality?: number;
  band?: string; channel?: number; channelWidth?: string; phyType?: string; rxMbps?: number; txMbps?: number; apCount?: number;
}

export interface SpeedTestRec {
  id: string; timestamp: number; serverName: string; serverProvider: string; idleLatencyMs?: number; jitterMs?: number;
  downloadMbps?: number; uploadMbps?: number; loadedLatencyMs?: number; bufferbloatGrade?: string; testMethodVersion: string;
}

export interface MonitorSampleRec { id?: number; sessionId: string; timestamp: number; target: string; rttMs?: number; isReachable: boolean; errorCode?: string }

export interface CameraRec {
  id: string; ipAddress: string; macAddress?: string; vendor?: string; hostname?: string; protocols: string[]; servicePorts: number[];
  confidence: Confidence; discoveredAt: number;
}

export interface Finding {
  id: string; severity: Severity; ip: string; host: string; title: string; port?: number;
  evidence: string[]; confidence: Confidence; explanation: string; recommendation: string; falsePositiveNote: string;
}

export interface TopologyLayoutRec { networkId: string; positions: Record<string, { x: number; y: number }>; updatedAt: number }
export interface SettingRec { key: string; value: unknown; updatedAt: number }
