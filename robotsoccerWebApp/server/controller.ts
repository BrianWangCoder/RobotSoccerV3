import dgram from 'dgram';
import type { ActiveStrategy } from './index';

const ROBOT_IPS: Record<number, string> = { 1: '192.168.1.201', 2: '192.168.1.202', 3: '192.168.1.203', 4: '192.168.1.204', 5: '192.168.1.205' };
const ROBOT_PORT = 4210;
const DT = 1 / 60;
const udp = dgram.createSocket('udp4');

let running = false;
export const isMatchRunning = () => running;
export const setRunning = (r: boolean) => (running = r);

export function startController(getActive: () => ActiveStrategy | null, broadcast: (m: unknown) => void) {
  setInterval(() => {
    const act = getActive();
    for (const id of Object.keys(ROBOT_IPS).map(Number)) {
      // TODO: world = latest camera frame → robot/ball positions in engine mm coordinates
      // TODO: { wl, wr } = engine decision for robot `id` under act.strategy
      const { wl, wr } = running && act ? { wl: 0, wr: 0 } : { wl: 0, wr: 0 };
      const pkt = Buffer.alloc(5);
      pkt.writeUInt8(id, 0);
      pkt.writeInt16LE(Math.round(wl), 1);
      pkt.writeInt16LE(Math.round(wr), 3);
      udp.send(pkt, ROBOT_PORT, ROBOT_IPS[id]);
    }
  }, DT * 1000);
}