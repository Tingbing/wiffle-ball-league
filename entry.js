const appEntry=new URL('app.html',location.href);appEntry.search=location.search;appEntry.hash=location.hash;location.replace(appEntry.href);
