import React from 'react';
import {BaseEdge,getBezierPath} from '@xyflow/react';
import type {EdgeProps} from '@xyflow/react';

/** A single visible path per directed pair. Returning to the same beat is a real loop. */
export function ConnectionEdge(props:EdgeProps){
  const {id,source,target,sourceX:sx,sourceY:sy,targetX:tx,targetY:ty,markerEnd,style,label,labelStyle,labelBgStyle}=props;
  const [path,x,y]=source===target
    ? [`M ${sx},${sy} C ${sx+85},${sy} ${sx+85},${sy-155} ${sx},${sy-155} L ${tx},${ty-155} C ${tx-85},${ty-155} ${tx-85},${ty} ${tx},${ty}`, (sx+tx)/2, Math.min(sy,ty)-155]
    : getBezierPath(props);
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={24}
    label={label} labelX={x} labelY={y} labelStyle={labelStyle} labelBgStyle={labelBgStyle}
    labelBgPadding={[7,5]} labelBgBorderRadius={5}/>;
}
