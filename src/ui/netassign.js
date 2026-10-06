/*
 * DSM desktop integration: registers NetAssign as a native DSM app window
 * that hosts index.html in an iframe. Same pattern as Synology's own
 * packages (e.g. WebDAV Server): an AppInstance naming its AppWindow.
 * Running inside the DSM desktop lets index.html read the session's
 * SynoToken from window.top.
 *
 * Keep the iframe page and its assets in app/: DSM injects certain
 * well-known files from a package's UI root (e.g. style.css) into the
 * whole DSM desktop, so page-level CSS there restyles every DSM window.
 */
Ext.namespace("SYNO.SDS.NetAssign");

Ext.define("SYNO.SDS.NetAssign.Instance", {
    extend: "SYNO.SDS.AppInstance",
    appWindowName: "SYNO.SDS.NetAssign.MainWindow"
});

Ext.define("SYNO.SDS.NetAssign.MainWindow", {
    extend: "SYNO.SDS.AppWindow",
    constructor: function (config) {
        this.callParent([Ext.apply({
            title: "NetAssign",
            width: 1100,
            height: 720,
            minWidth: 800,
            minHeight: 480,
            html: '<iframe src="/webman/3rdparty/NetAssign/app/index.html?v=@VERSION@" ' +
                'style="width:100%;height:100%;border:0;display:block"></iframe>'
        }, config)]);
    }
});
