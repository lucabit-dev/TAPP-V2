/** Copyright ©2025 Devexperts LLC.
All rights reserved. Any unauthorized use will constitute an infringement of copyright.
In case of any questions regarding types of use, please contact legal@devexperts.com.
This notice must remain intact.
**/
import { DXChartWidget } from './widget.config';
declare global {
    interface Window {
        DXChart: {
            widget: DXChartWidget;
        } & DXChartWidget;
    }
}
/**
 * @doc-tags chart-widget,api
 */
declare const _default: {
    widget: {
        createWidget: (container: HTMLElement, props: import("./widget.config").ChartReactWidgetProps) => Promise<{
            destroy: () => void;
        }>;
        destroy: () => void;
    };
    createWidget: (container: HTMLElement, props: import("./widget.config").ChartReactWidgetProps) => Promise<{
        destroy: () => void;
    }>;
    destroyGlobal: () => void;
    destroy: () => void;
};
export default _default;
