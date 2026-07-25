import { describe, it, expect } from 'vitest';
import { SFTPClient } from '../../src/ssh/sftp';
import { SSH_FXP_SETSTAT, SSH_FILEXFER_ATTR_PERMISSIONS } from '../../src/ssh/sftp-types';
import { readUint32 } from '../../src/ssh/utils';

describe('SFTPClient.setStat', () => {
  it('构造 SSH_FXP_SETSTAT 包：path + flags(PERMISSIONS) + mode', () => {
    const client = new SFTPClient();
    let sent: Uint8Array | null = null;
    client.setSendCallback((data) => { sent = data; });

    // 不 await（无响应回来），只捕获发出的包
    void client.setStat('/tmp/a.txt', 0o644);

    expect(sent).not.toBeNull();
    const pkt = sent as unknown as Uint8Array;
    // 包布局：len(4) | type(1) | reqId(4) | path-string(4+len) | attr-flags(4) | mode(4)
    const packetLen = readUint32(pkt, 0);
    expect(pkt.length).toBe(4 + packetLen);
    expect(pkt[4]).toBe(SSH_FXP_SETSTAT); // type = 9

    const pathLen = readUint32(pkt, 9);
    expect(pathLen).toBe('/tmp/a.txt'.length);
    const attrOffset = 9 + 4 + pathLen;
    expect(readUint32(pkt, attrOffset)).toBe(SSH_FILEXFER_ATTR_PERMISSIONS); // 0x04
    expect(readUint32(pkt, attrOffset + 4)).toBe(0o644);
  });
});
