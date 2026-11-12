import { expect, it } from 'vitest';
import vm from 'node:vm';
import { MUSE_DRIVER } from '../src/main/connectors/drivers';
it('captures the Muse persona video even when the document has no persona title', () => {
 const video = { getBoundingClientRect: () => ({ width: 128, height: 128 }), closest: () => null, readyState: 4, videoWidth: 128, videoHeight: 128 };
 const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=' };
 const context = vm.createContext({ getComputedStyle: () => ({ visibility: 'visible', display: 'block' }), document: {
  title: 'Muse', querySelectorAll: (selector: string) => selector.includes('video') ? [video] : [], createElement: () => canvas,
 } });
 vm.runInContext(MUSE_DRIVER, context);
 const result = vm.runInContext('globalThis.__agentstudio.profile()', context);
 expect(result.avatar?.frame).toBe('data:image/png;base64,iVBORw0KGgo=');
 expect(result.name).toBeNull();
});
