/** Copyright ©2025 Devexperts LLC.
All rights reserved. Any unauthorized use will constitute an infringement of copyright.
In case of any questions regarding types of use, please contact legal@devexperts.com.
This notice must remain intact.
**/
'use strict';(self['webpackChunkDXChart']=self['webpackChunkDXChart']||[])['push']([[0x2d9],{0x1e31:(a,b,c)=>{c['r'](b),c['d'](b,{'MultichartSettings':()=>D,'default':()=>E});var d=c(0xf8d0),e=c(0xa461),f=c(0x16c65),g=c(0x12fa0),h=c(0xc6b7),i=c(0xfd5f),j=c(0x4fb3);;const k=g['Ay']['div']['withConfig']({'displayName':'DXChart-MultichartSettingsContainerStyled','componentId':'DXChart-yqu8ud'})`
	font-family: var(--font-main-semibold);
	display: flex;
	padding: var(--spacer-2);
	gap: var(--spacer-2);
`,l=g['Ay']['div']['withConfig']({'displayName':'DXChart-MultichartSettingsSectionStyled','componentId':'DXChart-dhn4p0'})``,m=g['Ay']['div']['withConfig']({'displayName':'DXChart-MultichartSettingsHeaderStyled','componentId':'DXChart-3ony9d'})`
	color: var(--menu-secondary-text);
	font-size: var(--font-size-m);
	line-height: var(--line-height-m-px);
	margin-bottom: var(--spacer-2);
`,n=(0x0,g['Ay'])(m)['withConfig']({'displayName':'DXChart-MultichartSettingsHeaderRightStyled','componentId':'DXChart-uplh95'})`
	padding-left: var(--spacer-1);
`,o=g['Ay']['div']['withConfig']({'displayName':'DXChart-MultichartSettingsLayoutSelectorStyled','componentId':'DXChart-1mx9wx5'})`
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-content: space-between;
	width: 124px;
	height: fit-content;
	gap: var(--spacer-1);
`,p=g['Ay']['div']['withConfig']({'displayName':'DXChart-MultichartSettingsOptionListStyled','componentId':'DXChart-1bn4161'})`
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	font-size: var(--font-size-m);
	line-height: var(--line-height-s-px);
	margin-top: -2px;
`,q=g['Ay']['button']['withConfig']({'displayName':'DXChart-MultichartSettingsOptionStyled','componentId':'DXChart-m5ldiw'})`
	position: relative;
	display: flex;
	align-items: center;
	user-select: none;
	outline: 1px solid transparent;
	cursor: pointer;
	background-color: inherit;
	border: 0;
	border-radius: var(--spacer-1);
	font-family: var(--font-main-semibold);
	font-size: var(--font-size-m);
	padding: 0;

	&[disabled] {
		cursor: default;
	}

	&:hover {
		background-color: var(--menu-item-hover-bg);
	}

	&:focus-visible {
		outline: 1px solid var(--focus-border);
		outline-offset: -2px;
	}
`,r=g['Ay']['span']['withConfig']({'displayName':'DXChart-MultichartSettingsOptionCheckIconStyled','componentId':'DXChart-nszpub'})`
	position: absolute;
	display: block;
	width: 20px;
	height: 20px;
	color: var(--icon-primary);
`,s=g['Ay']['span']['withConfig']({'displayName':'DXChart-MultichartSettingsOptionTextStyled','componentId':'DXChart-rwla4n'})`
	margin-inline-start: var(--spacer-6);
	padding: var(--spacer-1) 0;
	padding-inline-end: var(--spacer-4);
	color: var(--menu-primary-text);
	font-size: var(--font-size-m);
	line-height: var(--line-height-m-px);
`,t=(0x0,g['Ay'])(s)['withConfig']({'displayName':'DXChart-MultichartSettingsDrawingsOptionTextStyled','componentId':'DXChart-iobmdp'})`
	padding-inline-end: var(--spacer-1);
`,u=g['Ay']['button']['withConfig']({'displayName':'DXChart-MultichartSettingsLayoutSelectorItemStyled','componentId':'DXChart-x16vdy'})`
	height: 38px;
	border: 0;
	outline: 1px solid transparent;
	padding: 0;
	display: block;
	background-color: var(--menu-bg);
	svg rect,
	svg path {
		fill: var(--multichart-layout-default-bg);
	}
	&:hover {
		${F=>!F['$active']&&(0x0,g['AH'])`
				background: var(--menu-bg);
				svg rect,
				svg path {
					fill: var(--multichart-layout-hover-bg);
				}
			`};
	}
	&:focus {
		outline: 1px solid var(--focus-border);
		outline-offset: 0;
		border-radius: 4px;
	}
	${F=>F['layout']&&v(F['layout'])}
	${F=>F['$active']&&(0x0,g['AH'])`
			svg rect,
			svg path {
				fill: var(--multichart-layout-selected-bg);
			}
		`}
`,v=F=>{switch(F){case'1x1':case'1x2':case'1x3':case'2x1':case'2x2':case'3x1':return(0x0,g['AH'])`
				width: 60px;
			`;case'2x4':return(0x0,g['AH'])`
				width: 124px;
			`;default:return(0x0,g['AH'])``;}},w=(0x0,g['Ay'])((0x0,h['Y']))['withConfig']({'displayName':'DXChart-MultichartSettingsDrawingsOptionTooltipIconStyled','componentId':'DXChart-lz42ol'})`
	color: ${F=>F['$hovered']?'var(--icon-tertiary-hover)':'var(--icon-tertiary-default)'};
`,x=(0x0,g['Ay'])((0x0,i['k']))['withConfig']({'displayName':'DXChart-WithDrawingsOptionTooltipStyled','componentId':'DXChart-u4qf53'})`
	margin-inline-start: var(--spacer-12);
	border-radius: 8px;
	${j['Kc']} {
		padding: var(--spacer-2) var(--spacer-4);
	}
`;var y=c(0x660e),z=c(0xa975),A=c(0x12d14),B=c(0x65f5),C=c(0x8fb6);;const D=(0x0,B['s'])('MultichartSettings',N=>{const {setLayout:O,selectedLayout:P,layouts:Q,isInstrumentSyncEnabled:R,isChartTypeSyncEnabled:S,isAggregationPeriodTypeSyncEnabled:T,isAppearanceSyncEnabled:U,isStudiesSyncEnabled:V,isCrosshairSyncEnabled:W,isDrawingsSyncEnabled:X,setInstrumentSync:Y,setChartTypeSync:Z,setAggregationPeriodTypeSync:a0,setAppearanceSync:a1,setStudiesSync:a2,setCrosshairSync:a3,setDrawingsSync:a4,className:a5,localization:a6}=N,[a7,a8]=(0x0,d['useState'])(![]),a9=(0x0,d['useRef'])(null),aa=(0x0,d['useRef'])(null),ab=(0x0,d['useCallback'])(()=>a8(!![]),[]),ac=(0x0,d['useCallback'])(()=>a8(![]),[]),ad=(0x0,d['useCallback'])(ap=>O(ap),[O]),ae=(0x0,d['useMemo'])(()=>ap=>(0x0,A['e'])(['Enter',()=>ad(ap)]),[ad]),af=(0x0,d['useCallback'])(()=>Y(!R||![]),[Y,R]),ag=(0x0,d['useCallback'])(()=>Z(!S),[Z,S]),ah=(0x0,d['useCallback'])(()=>a0(!T),[a0,T]),ai=(0x0,d['useCallback'])(()=>a1(!U),[a1,U]),aj=(0x0,d['useCallback'])(()=>a2(!V),[a2,V]),ak=(0x0,d['useCallback'])(()=>a3(!W),[a3,W]),al=(0x0,d['useCallback'])(()=>a4(!X),[a4,X]),am=(0x0,f['sE'])(),an=(0x0,z['r'])(aa),ao=(0x0,d['useCallback'])(ap=>{an(ap['nativeEvent']);},[an]);return d['createElement'](k,{'className':a5,'ref':aa,'onKeyDown':ao,'data-test-id':y['Y']['multichart_popover']},d['createElement'](l,null,d['createElement'](m,null,a6['multichart']['layout']),d['createElement'](o,{'data-test-id':y['Y']['multichart_layouts']},Q['map'](ap=>{const aq=P===ap,ar=(0x0,C['NV'])(ap,am);return d['createElement'](u,{'key':ap,'$active':aq,'data-active':aq,'onClick':()=>ad(ap),'onKeyDown':()=>ae(ap),'aria-label':ap,'layout':ap},ar);}))),d['createElement'](l,null,d['createElement'](n,null,a6['multichart']['synchronize']),d['createElement'](p,{'data-test-id':y['Y']['multichart_sync_options']},d['createElement'](q,{'onClick':af,'aria-label':a6['a11y_synchronize']['a11y_synchronize_instrument']},R&&d['createElement'](r,null,d['createElement'](e['h'],null,am['toolbar']['multichart']['settings']['checkboxTick'])),d['createElement'](s,null,a6['multichart']['sync_instrument'])),d['createElement'](q,{'onClick':ag,'aria-label':a6['a11y_synchronize']['a11y_synchronize_chart_type']},S&&d['createElement'](r,null,d['createElement'](e['h'],null,am['toolbar']['multichart']['settings']['checkboxTick'])),d['createElement'](s,null,a6['multichart']['sync_chart_type'])),d['createElement'](q,{'onClick':ah,'aria-label':a6['a11y_synchronize']['a11y_synchronize_timeframe']},T&&d['createElement'](r,null,d['createElement'](e['h'],null,am['toolbar']['multichart']['settings']['checkboxTick'])),d['createElement'](s,null,a6['multichart']['sync_timeframe'])),d['createElement'](q,{'onClick':ai,'aria-label':a6['a11y_synchronize']['a11y_synchronize_appearance']},U&&d['createElement'](r,null,d['createElement'](e['h'],null,am['toolbar']['multichart']['settings']['checkboxTick'])),d['createElement'](s,null,a6['multichart']['sync_appearance'])),d['createElement'](q,{'onClick':aj,'aria-label':a6['a11y_synchronize']['a11y_synchronize_studies']},V&&d['createElement'](r,null,d['createElement'](e['h'],null,am['toolbar']['multichart']['settings']['checkboxTick'])),d['createElement'](s,null,a6['multichart']['sync_studies'])),d['createElement'](q,{'onClick':ak,'aria-label':a6['a11y_synchronize']['a11y_synchronize_crosshair']},W&&d['createElement'](r,null,d['createElement'](e['h'],null,am['toolbar']['multichart']['settings']['checkboxTick'])),d['createElement'](s,null,a6['multichart']['sync_crosshair'])),d['createElement'](q,{'onClick':al,'aria-label':a6['a11y_synchronize']['a11y_synchronize_drawings']},X&&d['createElement'](r,null,d['createElement'](e['h'],null,am['toolbar']['multichart']['settings']['checkboxTick'])),d['createElement'](t,null,a6['multichart']['sync_drawings']),d['createElement'](x,{'label':a6['multichart']['sync_drawings_tooltip'],'showDelay':0x190,'hideDelay':0x64},d['createElement'](w,{'aria-describedby':'tooltip-content','$hovered':a7,'onMouseEnter':ab,'onMouseLeave':ac},d['createElement']('div',{'ref':a9},am['studies']['script']['help'])))))));}),E=D;}}]);