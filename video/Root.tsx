import React, { useEffect, useState } from 'react';
import { Composition, continueRender, delayRender } from 'remotion';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import { DEFAULT_VIDEO_PROPS, FPS, PRESETS, RasdVideo, videoSchema, type VideoProps } from './compositions/RasdVideo';

const FontGate: React.FC<VideoProps> = (props) => {
  const [handle] = useState(() => delayRender('Loading Arabic font'));
  useEffect(() => {
    Promise.all(['400', '500', '600', '700'].map((w) => document.fonts.load(`${w} 32px "IBM Plex Sans Arabic"`, 'رصد')))
      .catch(() => undefined)
      .finally(() => continueRender(handle));
  }, [handle]);
  return <RasdVideo {...props} />;
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="RasdSimulation"
    component={FontGate}
    schema={videoSchema}
    defaultProps={DEFAULT_VIDEO_PROPS}
    fps={FPS}
    durationInFrames={DEFAULT_VIDEO_PROPS.durationSec * FPS}
    width={1920}
    height={1080}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.round(props.durationSec * FPS),
      width: PRESETS[props.preset].w,
      height: PRESETS[props.preset].h,
    })}
  />
);
