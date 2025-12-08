/** Copyright ©2025 Devexperts LLC.
All rights reserved. Any unauthorized use will constitute an infringement of copyright.
In case of any questions regarding types of use, please contact legal@devexperts.com.
This notice must remain intact.
**/
'use strict';(self['webpackChunkDXChart']=self['webpackChunkDXChart']||[])['push']([[0x274],{0xc5c4:(a,b,c)=>{c['r'](b),c['d'](b,{'InstrumentSuggestComponent':()=>v,'MainInstrumentSelectorContainer':()=>w,'default':()=>x});var d=c(0x15f29),e=c(0xc138),f=c(0xf8d0),g=c(0x660e),h=c(0x8c58),i=c(0x65f5),j=c(0xc712),k=c(0x12201),l=c(0xfa40),m=c(0x3ffe),n=c(0x102f),o=c(0x12fa0),p=c(0x1ec8),q=c(0x17efc),r=c(0x603f);;const s=(0x0,o['Ay'])((0x0,q['s']))['withConfig']({'displayName':'DXChart-MainSymbolSuggestStyled','componentId':'DXChart-oeznis'})`
	${r['YN']} {
		background: var(--chart-bg);
		width: var(--main-symbol-suggest-input-width, 100px);
		max-width: var(--main-symbol-suggest-input-mxw, 100px);
		height: var(--main-symbol-suggest-input-height, 32px);
		border-right: 1px solid var(--chart-grid);

		&:focus-within {
			outline-offset: -1px;
		}
	}

	${p['ZE']} {
		border-radius: 0;
		padding: 0px;
	}

	${p['aC']} {
		height: var(--main-symbol-suggest-input-height, 48px);
		width: var(--main-symbol-suggest-input-mxw, 80px);
		padding: var(--spacer-4) var(--spacer-3);
		font-family: var(--font-main-semibold);
		font-size: var(--font-size-m);
		line-height: var(--line-height-m-px);

		&::placeholder {
			color: var(--input-disabled-text);
		}

		&:disabled {
			color: var(--input-disabled-text);
		}

		&:hover:enabled:not(:focus) {
			background-color: var(--menu-item-hover-bg);
		}

		&:hover:disabled {
			background-color: var(--chart-bg);
		}

		&::selection {
			background: var(--text-selection-bg);
		}

		&:focus-within,
		&:active {
			outline-offset: -1px;
		}

		&[disabled]::selection,
		&:disabled::selection {
			background: var(--chart-bg);
		}
	}
`,t=o['Ay']['div']['withConfig']({'displayName':'DXChart-InstrumentSelectorDataStateFailureStyled','componentId':'DXChart-uo17r1'})`
	position: absolute;
	bottom: 0;
	left: 0;
	z-index: 1;
	height: 1px;
	width: 100px;
	background-color: var(--chart-bear-default);
`;var u=c(0x16c65);;const v=h['_O']['combine'](h['_O']['key']()('instrumentSelectorViewModel'),h['_O']['key']()('chartDataViewModel'),h['_O']['key']()('chartReactConfig'),(y,z,A)=>{const B=C=>{const {instrument:D,onInstrumentChanged:E}=C,{localization:F}=(0x0,f['useContext'])(m['e']),[G,H]=(0x0,f['useState'])(![]),I=(0x0,f['useCallback'])(()=>H(![]),[]),J=(0x0,f['useCallback'])(()=>H(!![]),[]),K=(0x0,f['useCallback'])(N=>{z['changeInstrument']((0x0,d['zN'])(N['symbol'])),E((0x0,n['B'])(N)),I();},[I,E]),L=(0x0,l['J'])(y['data$'],[]),M=L['map'](n['O']);return f['createElement'](s,{'data':M,'selectedInstrument':D,'placeholder':F['toolbar']['instrumentSelector']['placeholder'],'disabled':!A['instrumentSuggest']['enabled'],'opened':G,'onFocus':J,'initialFocus':![],'searchInstruments':y['searchInstruments'],'onCloseRequest':I,'onBlur':I,'onEnter':K,'DataStateNoData':t,'testId':g['Y']['suggest_main']});};return B;}),w=h['_O']['combine'](h['_O']['key']()('chartDataViewModel'),h['_O']['key']()('instrumentSelectorViewModel'),h['_O']['key']()('chartReactConfig'),v,(y,z,A,B)=>(0x0,k['J'])(A['instrumentSuggest']['visible'],(0x0,i['s'])('InstrumentSelectorContainer',()=>{const C=(0x0,f['useCallback'])(G=>{y['changeInstrument']((0x0,d['zN'])(G['symbol'])),z['onChangeInstrument'](G);},[]),D=(0x0,j['NC'])(y['selectedInstrument']),E=(0x0,e['Fs'])(D,d['WL'](()=>'')),F=(0x0,u['sm'])(['InstrumentSuggest'])??B;return f['createElement'](F,{'onInstrumentChanged':C,'instrument':E});}))),x=w;}}]);