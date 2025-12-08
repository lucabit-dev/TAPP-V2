/** Copyright ©2025 Devexperts LLC.
All rights reserved. Any unauthorized use will constitute an infringement of copyright.
In case of any questions regarding types of use, please contact legal@devexperts.com.
This notice must remain intact.
**/
'use strict';(self['webpackChunkDXChart']=self['webpackChunkDXChart']||[])['push']([[0x3e5],{0x1f3d:(a,b,c)=>{c['r'](b),c['d'](b,{'ChartSettingsEventsContainer':()=>p,'default':()=>q});var d=c(0xf8d0),e=c(0x8c58),f=c(0x65f5),g=c(0x12e5c),h=c(0xd114),i=c(0x3ffe),j=c(0xb116),k=c(0x147f4),l=c(0x6620),m=c(0x8bd);;const n=(0x0,d['memo'])(r=>{const {value:s,localization:t,onValueChange:u,a11yTabProps:{role:v,id:w,ariaLabelledBy:x},onRestoreDefaultRequest:y,showRestoreToDefault:z}=r,A=(0x0,d['useCallback'])((G=![])=>{u((0x0,j['K'])(['chartCore','components','events','visible']),G);},[u]),B=(0x0,d['useCallback'])((G=![])=>{u((0x0,j['K'])(['chartCore','components','events','eventsVisibility','dividends']),G);},[u]),C=(0x0,d['useCallback'])((G=![])=>{u((0x0,j['K'])(['chartCore','components','events','eventsVisibility','splits']),G);},[u]),D=(0x0,d['useCallback'])((G=![])=>{u((0x0,j['K'])(['chartCore','components','events','eventsVisibility','earnings']),G);},[u]),E=(0x0,d['useCallback'])((G=![])=>{u((0x0,j['K'])(['chartCore','components','events','eventsVisibility','conference-calls']),G);},[u]),F=(0x0,d['useCallback'])((G=![])=>{u((0x0,j['K'])(['chartCore','components','news','visible']),G);},[u]);return d['createElement'](m['au'],null,d['createElement'](l['PY'],{'role':v,'id':w,'aria-labelledby':x},d['createElement'](k['z'],{'label':t['settingsPopup']['tabs']['events']['eventsOnChart'],'value':s['components']['events']['visible'],'onValueChange':A}),d['createElement'](k['z'],{'disabled':!s['components']['events']['visible'],'label':t['settingsPopup']['tabs']['events']['dividends'],'value':s['components']['events']['visible']&&s['components']['events']['eventsVisibility']['dividends'],'onValueChange':B}),d['createElement'](k['z'],{'disabled':!s['components']['events']['visible'],'label':t['settingsPopup']['tabs']['events']['splits'],'value':s['components']['events']['visible']&&s['components']['events']['eventsVisibility']['splits'],'onValueChange':C}),d['createElement'](k['z'],{'disabled':!s['components']['events']['visible'],'label':t['settingsPopup']['tabs']['events']['earnings'],'value':s['components']['events']['visible']&&s['components']['events']['eventsVisibility']['earnings'],'onValueChange':D}),d['createElement'](k['z'],{'disabled':!s['components']['events']['visible'],'label':t['settingsPopup']['tabs']['events']['conference-calls'],'value':s['components']['events']['visible']&&s['components']['events']['eventsVisibility']['conference-calls'],'onValueChange':E}),d['createElement'](k['z'],{'disabled':!s['components']['events']['visible'],'label':t['settingsPopup']['tabs']['events']['newsTitle'],'value':s['components']['events']['visible']&&s['components']['news']['visible'],'onValueChange':F})),z&&d['createElement'](m['ov'],{'onClick':y},t['settingsPopup']['resetToDefaultsBtn']));}),o=null&&n;;const p=e['_O']['combine'](e['_O']['key']()('chartConfiguratorViewModel'),r=>(0x0,f['s'])('ChartSettingsEventsContainer',s=>{const {localization:t}=(0x0,d['useContext'])(i['e']),u=(0x0,h['k'])(r['state'],['settings','chartCore']),{defaultConfig:v}=s,w=(0x0,d['useMemo'])(()=>!(0x0,g['bD'])(v['chartCore'],u),[u,v]),x=(0x0,d['useCallback'])(()=>r['onRestoreDefaultConfigTab'](v),[v]);return(0x0,d['createElement'])(n,{'showRestoreToDefault':w,'localization':t,'onValueChange':r['setSettingsByPath'],'value':u,'a11yTabProps':s['a11yTabProps'],'onRestoreDefaultRequest':x});})),q=p;},0x6620:(a,b,c)=>{c['d'](b,{'BF':()=>r,'T5':()=>s,'v3':()=>w,'RQ':()=>t,'M6':()=>u,'at':()=>y,'PY':()=>A,'xK':()=>q,'HQ':()=>p,'k$':()=>v,'Gf':()=>x});var d=c(0x8b0b),e=c(0x12fa0),f=c(0x1610a),g=c(0xfa78),h=c(0xc514),i=c(0x6333),j=c(0x10fc5),k=c(0x2668);;const l=(0x0,e['Ay'])((0x0,k['r']))['withConfig']({'displayName':'DXChart-DropdownMenuSecondaryStyled','componentId':'DXChart-1gffxgq'})`
	background-color: var(--menu-secondary-bg);
	${j['xV']} {
		&:hover {
			background-color: var(--menu-secondary-item-hover-bg);
		}
	}
`;var m=c(0x2a4d),n=c(0xa277),o=c(0x111c4);;const p=(0x0,e['Ay'])((0x0,f['gs']))['withConfig']({'displayName':'DXChart-ChartSettingsTabGeneralItemStyled','componentId':'DXChart-lzkuwf'})`
	&:hover {
		background-color: var(--menu-item-hover-bg);
		border-radius: var(--spacer-1);
	}

	${d['UX']} {
		width: 100%;
		outline: 1px solid transparent;
		background-color: transparent;

		&:focus {
			box-shadow: none;
		}
	}

	${d['mZ']} {
		border: none;
		width: 100%;
		height: 100%;
	}

	${d['GD']} {
		width: 100%;
		height: 100%;
	}

	${B=>B['$keyboardModeEnabled']&&'&:focus-within\x20{\x0a\x09\x09border-radius:\x204px;\x0a\x20\x20\x20\x20\x09box-shadow:\x200\x200\x200\x201px\x20var(--button-primary-default-bg);\x0a\x09}'}
`,q=(0x0,e['Ay'])(p)['withConfig']({'displayName':'DXChart-ChartSettingsTabGeneralItemLineStyled','componentId':'DXChart-xj3odh'})`
	display: flex;
	margin-inline-start: var(--spacer-6);
	&:hover {
		background-color: var(--menu-bg);
	}
`,r=(0x0,e['Ay'])((0x0,o['A']))['withConfig']({'displayName':'DXChart-ChartSettingsTabAdaptivePopoverStyled','componentId':'DXChart-tvfy6u'})`
	margin-top: 0;
`,s=(0x0,e['Ay'])((0x0,g['x']))['withConfig']({'displayName':'DXChart-ChartSettingsTabCrosshairAnchorStyled','componentId':'DXChart-1dqyfb3'})`
	padding: 0;
	padding-right: var(--spacer-3);
	height: 16px;
	box-sizing: border-box;
	border-radius: 4px;
	background: transparent;
	&:after {
		border: none;
	}
	&:hover {
		background: none;
	}

	${h['XQ']} {
		text-align: left;
		font-size: var(--font-size-m);
		line-height: var(--line-height-m);
		color: var(--menu-active-text);
		font-family: var(--font-main-semibold);
	}

	${h['P3']} {
		width: 20px;
		height: 20px;
	}

	${h['P3']} {
		box-sizing: border-box;
		position: absolute;
		left: calc(100% - 4px);
		top: 0;
		// add transform-origin for the tricky transform: rotate case - the element moves by 1px at the end of the transition
		transform-origin: 10px 9px 0px;
		transition: transform ease 0.4s;
		display: flex;
		align-items: center;
		justify-content: center;
		${B=>B['isOpened']&&(0x0,e['AH'])`
				transform: rotate(180deg);
			`}
	}
`,t=(0x0,e['Ay'])((0x0,i['_']))['withConfig']({'displayName':'DXChart-ChartSettingsTabCrosshairDropdownMenuItemStyled','componentId':'DXChart-1x1bs31'})`
	padding: var(--spacer-1);
	width: 100%;
	box-sizing: border-box;
	min-width: 0;
	color: var(--menu-primary-text);

	${j['pC']} {
		font-family: var(--font-main-semibold);
		font-size: var(--font-size-m);
		line-height: var(--line-height-m);
	}
`,u=(0x0,e['Ay'])(l)['withConfig']({'displayName':'DXChart-ChartSettingsTabCrosshairDropdownMenuStyled','componentId':'DXChart-1jpkg2'})`
	width: 80px;
	box-sizing: border-box;
	padding: var(--spacer-1);
`,v=(0x0,e['Ay'])((0x0,m['M']))['withConfig']({'displayName':'DXChart-ChartSettingsTabMenuSelectboxStyled','componentId':'DXChart-1ekvzqy'})`
	margin-inline-start: var(--spacer-1);
	&:hover {
		background-color: var(--menu-item-hover-bg);
	}
`,w=e['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsTabCrosshairContainerStyled','componentId':'DXChart-1kvs05l'})`
	display: flex;
	align-items: center;
`,x=(0x0,e['Ay'])(p)['withConfig']({'displayName':'DXChart-ChartSettingsTabPriceTypeContainerStyled','componentId':'DXChart-f9vvoy'})`
	display: flex;
	align-items: center;
	margin-inline-start: var(--spacer-6);

	&:hover {
		background-color: var(--menu-bg);
	}
`,y=e['Ay']['hr']['withConfig']({'displayName':'DXChart-ChartSettingsTabDivider','componentId':'DXChart-1km3yu5'})`
	margin: var(--spacer-0);
	height: 1px;
	border: none;
	background-color: var(--menu-divider);
	visibility: ${B=>B['visible']?'visible':'hidden'};
`,z=(0x0,e['Ay'])((0x0,n['$']))['withConfig']({'displayName':'DXChart-ChartSettingsResetButton','componentId':'DXChart-1cdtfgp'})`
	height: 24px;
	padding: var(--spacer-1);
	font-family: var(--font-main-semibold);
	font-size: var(--font-size-m);
	line-height: var(--line-height-m);
	color: var(--link-default-text);
	margin-top: var(--spacer-3);

	border: 1px solid transparent;

	&:focus {
		border-color: var(--focus-border);
	}
`,A=e['Ay']['form']['withConfig']({'displayName':'DXChart-ChartSettingsTabForm','componentId':'DXChart-1f81gd3'})``;},0x147f4:(a,b,c)=>{c['d'](b,{'z':()=>j});var d=c(0xf8d0),e=c(0xf3d5),f=c(0x3ffe),g=c(0x61da),h=c(0x6620),i=c(0x660e);const j=(0x0,d['memo'])(k=>{const {label:l,value:m,onValueChange:n,disabled:disabled=![],fieldTestId:o}=k,{keyboardModeEnabled:p}=(0x0,d['useContext'])(f['e']);return d['createElement'](h['HQ'],{'$keyboardModeEnabled':p},d['createElement'](g['s'],{'label':l,'isDisabled':disabled,'testId':o},d['createElement'](e['S'],{'isDisabled':disabled,'value':m,'onValueChange':n,'data-test-id':i['Y']['chart_settings_checkbox']})));});},0x1610a:(a,b,c)=>{c['d'](b,{'VU':()=>f,'gs':()=>j});var d=c(0x12fa0);const e=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldset','componentId':'DXChart-1hmow83'})`
	display: flex;
	flex-wrap: wrap;
	border: 0;
	margin: 0;
	font: inherit;
	border-top: 1px solid var(--menu-divider);
	padding: var(--spacer-3) var(--spacer-6) var(--spacer-6) var(--spacer-1);

	&:first-child {
		border-top: none;
	}
`,f=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetContainer','componentId':'DXChart-2uo8j'})`
	display: flex;
	flex-direction: column;
`,g=d['Ay']['h3']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetHeader','componentId':'DXChart-kh4jvg'})`
	display: block;
	color: var(--form-title-text);
	font-size: var(--font-size-m);
	line-height: var(--line-height-l);
	font-family: var(--font-main-bold);
	text-transform: uppercase;
	letter-spacing: 0.84px;
	margin: 0;
	margin-bottom: var(--spacer-2);
	margin-left: var(--spacer-2);
`,h=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetBody','componentId':'DXChart-1ua2u5a'})`
	display: flex;
	flex-wrap: wrap;
`,i=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetGroup','componentId':'DXChart-1o3n007'})`
	${l=>l['vertical']?(0x0,d['AH'])`
					&:not(:first-child) {
						margin-top: var(--spacer-2);
					}
			  `:(0x0,d['AH'])`
					&:not(:last-child) {
						margin-right: var(--spacer-2);
					}
			  `}
`,j=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetGroupItem','componentId':'DXChart-15kedd4'})`
	width: auto;
	box-sizing: border-box;
	margin: 0;
	margin-bottom: var(--spacer-1);
	padding: var(--spacer-05) var(--spacer-1);
`,k=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldsetGroupItemText','componentId':'DXChart-1tgyoyg'})`
	font-family: var(--font-main-semibold);
	font-size: var(--font-size-m);
	line-height: var(--line-height-m);
	color: var(--menu-primary-text);
	margin-bottom: var(--spacer-2);
`;}}]);