import { describe, expect, it } from 'vitest';
import {
  clampPipOuterSize,
  PIP_CUELIST_PANEL_PX,
  PIP_RECAP_PANEL_PX,
  pipSidePanelExtraPx,
} from './pip-ui-shell';

describe('pip side panel window extra', () => {
  it('adds recap and cue-list rails independently', () => {
    expect(pipSidePanelExtraPx({})).toBe(0);
    expect(pipSidePanelExtraPx({ recapOpen: true })).toBe(PIP_RECAP_PANEL_PX);
    expect(pipSidePanelExtraPx({ cueListOpen: true })).toBe(PIP_CUELIST_PANEL_PX);
    expect(pipSidePanelExtraPx({ recapOpen: true, cueListOpen: true })).toBe(
      PIP_RECAP_PANEL_PX + PIP_CUELIST_PANEL_PX,
    );
  });

  it('clamps PiP outer size to the work area without shrinking below min', () => {
    expect(
      clampPipOuterSize({
        width: 4000,
        height: 2000,
        availWidth: 1440,
        availHeight: 900,
      }),
    ).toEqual({ width: 1440, height: 900 });

    expect(
      clampPipOuterSize({
        width: 200,
        height: 100,
        availWidth: 1440,
        availHeight: 900,
      }),
    ).toEqual({ width: 480, height: 320 });
  });
});
