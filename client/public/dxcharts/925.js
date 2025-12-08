/** Copyright ©2025 Devexperts LLC.
All rights reserved. Any unauthorized use will constitute an infringement of copyright.
In case of any questions regarding types of use, please contact legal@devexperts.com.
This notice must remain intact.
**/
'use strict';(self['webpackChunkDXChart']=self['webpackChunkDXChart']||[])['push']([[0x39d],{0x3665:(a,b,c)=>{c['r'](b),c['d'](b,{'ChartSettingsPaddingsContainer':()=>G,'default':()=>H});var d=c(0xf8d0),e=c(0x8c58),f=c(0x65f5),g=c(0x12e5c),h=c(0xd114),i=c(0xc0f0),j=c(0x1602e),k=c(0x4325),l=c(0x12fa0),m=c(0x1ec8);;const n=(0x0,l['Ay'])((0x0,k['p']))['withConfig']({'displayName':'DXChart-SimpleNumericStepperInputStyled','componentId':'DXChart-15tbkko'})`
	background: transparent;
`,o=l['Ay']['label']['withConfig']({'displayName':'DXChart-SimpleNumericStepperContainerStyled','componentId':'DXChart-kn9ww3'})`
	font-size: var(--font-size-m);
	user-select: none;
	color: var(--checkbox-default-text);
	white-space: nowrap;
	cursor: ${I=>I['orientation']==='h'?'ew-resize':'ns-resize'};

	${I=>I['$disabled']===!![]&&(0x0,l['AH'])`
			color: var(--checkbox-default-text);
			cursor: default;
		`}

	width: fit-content;
	display: flex;
	align-items: center;
	justify-content: flex-start;

	${m['aC']} {
		width: calc(${I=>I['$innerWidth']+0x1}px + var(--spacer-2));
		//change to own variable when it appears in figma
		color: var(--menu-active-text);
		font-family: var(--font-main-semibold);
	}
	${n} {
		width: calc(${I=>I['$innerWidth']+0x1}px + var(--spacer-2)); // calc innerWidth + current padding
		padding: var(--spacer-unit) var(--spacer-unit);
	}

	${m['ZE']} {
		&:hover {
			background: none;
		}
	}
`,p=l['Ay']['span']['withConfig']({'displayName':'DXChart-SimpleNumericStepperLabelStyled','componentId':'DXChart-1g4hrdc'})`
	display: inline-block;
	vertical-align: middle;
	font-size: var(--font-size-m);
	line-height: var(--line-height-m);
	font-family: var(--font-main-semibold);
	color: var(--menu-primary-text);
	margin-right: var(--spacer-1);

	${I=>I['$isDisabled']&&(0x0,l['AH'])`
			color: var(--icon-disabled);
			cursor: default;
		`};
`,q=l['Ay']['span']['withConfig']({'displayName':'DXChart-SimpleNumericStepperControlStyled','componentId':'DXChart-k3je38'})`
	display: inline-block;
	vertical-align: middle;
`,r=l['Ay']['span']['withConfig']({'displayName':'DXChart-SimpleNumericStepperUnitControl','componentId':'DXChart-1g9qpu2'})`
	color: var(--menu-active-text);
	font-family: var(--font-main-semibold);
	margin-left: var(--spacer-1);
`;o['displayName']='CKSimpleNumericStepperContainerStyled',p['displayName']='CKSimpleNumericStepperLabelStyled',q['displayName']='CKSimpleNumericStepperControlStyled',r['displayName']='CKSimpleNumericStepperUnitControl';;const s={'v':'clientY','h':'clientX'},t={'v':{'increase':'ArrowUp','decrease':'ArrowDown'},'h':{'increase':'ArrowRight','decrease':'ArrowLeft'}},u=I=>String(I),v=(I,J,K)=>Math['max'](Math['min'](I,K),J),w=(0x0,d['memo'])(I=>{const {className:J,value:K,onValueChange:L,orientation:orientation='h',sensitivity:sensitivity=0x8,max:max=Number['POSITIVE_INFINITY'],min:min=Number['NEGATIVE_INFINITY'],ariaLabel:M,label:N,isDisabled:O,id:P,units:units='%',isChangingCallback:Q}=I,[R,S]=(0x0,d['useState'])(null),[T,U]=(0x0,d['useState'])(0x0),V=(0x0,d['useMemo'])(()=>(0x0,i['q'])(u(K),'normal\x20normal\x20400\x2012px\x20Open\x20Sans'),[K]),W=(0x0,d['useCallback'])(a3=>{const a4=Math['trunc'](a3/sensitivity),a5=v(T+a4,min,max);L(a5);},[L,T,sensitivity,max,min]),X=(0x0,d['useCallback'])(a3=>{window['TouchEvent']&&a3['nativeEvent']instanceof TouchEvent?S(a3['changedTouches'][0x0][s[orientation]]||a3['targetTouches'][0x0][s[orientation]]):S(a3[s[orientation]]||a3['nativeEvent'][s[orientation]]),U(K);},[orientation,K]),Y=(0x0,d['useCallback'])(()=>{S(null),U(0x0),Q?.(![]);},[Q]),Z=(0x0,d['useCallback'])(a3=>{if(R&&!O){a3['preventDefault']();let a4=0x0;window['TouchEvent']&&a3 instanceof TouchEvent?a4=a3['changedTouches'][0x0][s[orientation]]||a3['targetTouches'][0x0][s[orientation]]:a4=a3[s[orientation]];const a5=orientation==='h'?a4-R:R-a4;W(a5),Q?.(!![]);}},[R,orientation,W,Q,O]);(0x0,d['useEffect'])(()=>{return document['addEventListener']('mousemove',Z),document['addEventListener']('mouseup',Y),document['addEventListener']('touchmove',Z),document['addEventListener']('touchend',Y),document['addEventListener']('touchcancel',Y),()=>{document['removeEventListener']('mousemove',Z),document['removeEventListener']('mouseup',Y),document['removeEventListener']('touchmove',Z),document['removeEventListener']('touchend',Y),document['removeEventListener']('touchcancel',Y);};},[Z,Y]);const a0=(0x0,d['useCallback'])(a3=>{a3===''&&L(0x0);if(a3!==undefined&&/^-?[0-9]/g['test'](a3)){const a4=parseInt(a3,0xa),a5=isNaN(a4)?0x0:a4,a6=v(a5,min,max);L(a6);}},[L,min,max]),a1=(0x0,d['useCallback'])((a3,a4=!![])=>{const a5=v(K+a3,min,max);L(a5),Q?.(a4);},[K,L,min,max,Q]),a2=(0x0,d['useCallback'])(a3=>{switch(a3['code']){case t[orientation]['increase']:a3['preventDefault'](),a1(0x1,![]);break;case t[orientation]['decrease']:a3['preventDefault'](),a1(-0x1,![]);break;}},[a1,orientation]);return d['createElement'](o,{'$innerWidth':V,'$disabled':O,'onMouseDown':X,'onTouchStart':X,'htmlFor':P,'orientation':orientation},d['createElement'](p,{'$isDisabled':O},N),d['createElement'](q,null,d['createElement'](n,{'id':P,'ariaLabel':M,'ariaDescribedby':j['WN'],'value':u(K),'onValueChange':a0,'className':J,'onKeyDown':a2,'onKeyUp':Y,'isDisabled':O})),d['createElement'](r,null,units));});var x=c(0xb116),y=c(0x3ffe),z=c(0x6620);;const A=l['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsPaddingsControlStyled','componentId':'DXChart-1wi1a52'})`
	width: calc(100% - var(--spacer-2));
	padding: 0 var(--spacer-2);
	height: 28px;
	&:hover {
		background-color: var(--menu-item-hover-bg);
		border-radius: var(--spacer-1);
	}

	${o} {
		width: 100%;
	}
`;var B=c(0x8bd);;const C=0x1e,D=0x3e7,E=(0x0,d['memo'])(I=>{const {localization:J}=(0x0,d['useContext'])(y['e']),{value:K,onValueChange:L,a11yTabProps:{role:M,id:N,ariaLabelledBy:O},showRestoreToDefault:P,onRestoreDefaultRequest:Q}=I,R=K['chartCore']['components']['offsets'],{visible:S,top:T,bottom:U,right:V}=R,[W,X]=(0x0,d['useState'])(![]),Y=(0x0,d['useCallback'])(a1=>{L((0x0,x['K'])(['chartCore','components','offsets','top']),a1);},[L]),Z=(0x0,d['useCallback'])(a1=>{L((0x0,x['K'])(['chartCore','components','offsets','bottom']),a1);},[L]),a0=(0x0,d['useCallback'])(a1=>{L((0x0,x['K'])(['chartCore','components','offsets','right']),a1);},[L]);return d['createElement'](B['au'],null,d['createElement'](z['PY'],{'role':M,'id':N,'aria-labelledby':O},d['createElement'](A,null,d['createElement'](w,{'value':T??0x0,'onValueChange':Y,'units':'%','min':0x0,'max':C,'orientation':'h','sensitivity':0x2,'label':J['settingsPopup']['tabs']['paddings']['top'],'isDisabled':!S,'isChangingCallback':X})),d['createElement'](A,null,d['createElement'](w,{'value':V??0x0,'onValueChange':a0,'units':J['settingsPopup']['tabs']['paddings']['bars'],'min':0x0,'max':D,'orientation':'h','sensitivity':0x2,'label':J['settingsPopup']['tabs']['paddings']['right'],'isDisabled':!S,'isChangingCallback':X})),d['createElement'](A,null,d['createElement'](w,{'value':U??0x0,'onValueChange':Z,'units':'%','min':0x0,'max':C,'orientation':'h','sensitivity':0x2,'label':J['settingsPopup']['tabs']['paddings']['bottom'],'isDisabled':!S,'isChangingCallback':X}))),P&&!W&&d['createElement'](B['ov'],{'onClick':Q},J['settingsPopup']['resetToDefaultsBtn']));}),F=null&&E;;const G=e['_O']['combine'](e['_O']['key']()('chartConfiguratorViewModel'),I=>(0x0,f['s'])('ChartSettingsPaddingsContainer',J=>{const K=(0x0,h['k'])(I['state'],['settings']),{defaultConfig:L}=J,M=(0x0,d['useMemo'])(()=>!(0x0,g['bD'])(L,K),[K,L]),N=(0x0,d['useCallback'])(()=>I['onRestoreDefaultConfigTab'](L),[L]);return(0x0,d['createElement'])(E,{'showRestoreToDefault':M,'onValueChange':I['setSettingsByPath'],'value':K,'a11yTabProps':J['a11yTabProps'],'onRestoreDefaultRequest':N});})),H=G;},0x6620:(a,b,c)=>{c['d'](b,{'BF':()=>r,'T5':()=>s,'v3':()=>w,'RQ':()=>t,'M6':()=>u,'at':()=>y,'PY':()=>A,'xK':()=>q,'HQ':()=>p,'k$':()=>v,'Gf':()=>x});var d=c(0x8b0b),e=c(0x12fa0),f=c(0x1610a),g=c(0xfa78),h=c(0xc514),i=c(0x6333),j=c(0x10fc5),k=c(0x2668);;const l=(0x0,e['Ay'])((0x0,k['r']))['withConfig']({'displayName':'DXChart-DropdownMenuSecondaryStyled','componentId':'DXChart-1gffxgq'})`
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
`,A=e['Ay']['form']['withConfig']({'displayName':'DXChart-ChartSettingsTabForm','componentId':'DXChart-1f81gd3'})``;},0x1610a:(a,b,c)=>{c['d'](b,{'VU':()=>f,'gs':()=>j});var d=c(0x12fa0);const e=d['Ay']['div']['withConfig']({'displayName':'DXChart-ChartSettingsFieldset','componentId':'DXChart-1hmow83'})`
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