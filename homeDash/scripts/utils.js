/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Home Dash Utility.
 *
 * The Initial Developer of the Original Code is The Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Edward Lee <edilee@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";

/**
 * Get a localized string with string replacement arguments filled in and
 * correct plural form picked if necessary.
 *
 * @note: Initialize the strings to use with getString.init(addon).
 *
 * @usage getString(name): Get the localized string for the given name.
 * @param [string] name: Corresponding string name in the properties file.
 * @return [string]: Localized string for the string name.
 *
 * @usage getString(name, arg): Replace %S references in the localized string.
 * @param [string] name: Corresponding string name in the properties file.
 * @param [any] arg: Value to insert for instances of %S.
 * @return [string]: Localized string with %S references replaced.
 *
 * @usage getString(name, args): Replace %1$S references in localized string.
 * @param [string] name: Corresponding string name in the properties file.
 * @param [array of any] args: Array of values to replace references like %1$S.
 * @return [string]: Localized string with %N$S references replaced.
 *
 * @usage getString(name, args, plural): Pick the correct plural form.
 * @param [string] name: Corresponding string name in the properties file.
 * @param [array of any] args: Array of values to replace references like %1$S.
 * @param [number] plural: Number to decide what plural form to use.
 * @return [string]: Localized string of the correct plural form.
 */
function getString(name, args, plural) {
  // Use the cached bundle to retrieve the string
  let str;
  try {
    str = getString.bundle.GetStringFromName(name);
  }
  // Use the fallback in-case the string isn't localized
  catch(ex) {
    str = getString.fallback.GetStringFromName(name);
  }

  // Pick out the correct plural form if necessary
  if (plural != null)
    str = getString.plural(plural, str);

  // Fill in the arguments if necessary
  if (args != null) {
    // Convert a string or something not array-like to an array
    if (typeof args == "string" || args.length == null)
      args = [args];

    // Assume %S refers to the first argument
    str = str.replace(/%s/gi, args[0]);

    // Replace instances of %N$S where N is a 1-based number
    Array.forEach(args, function(replacement, index) {
      str = str.replace(RegExp("%" + (index + 1) + "\\$S", "gi"), replacement);
    });
  }

  return str;
}

/**
 * Initialize getString() for the provided add-on.
 *
 * @usage getString.init(addon): Load properties file for the add-on.
 * @param [object] addon: Add-on object from AddonManager
 *
 * @usage getString.init(addon, getAlternate): Load properties with alternate.
 * @param [object] addon: Add-on object from AddonManager
 * @param [function] getAlternate: Convert a locale to an alternate locale
 */
getString.init = function(addon, getAlternate) {
  // Set a default get alternate function if it doesn't exist
  if (typeof getAlternate != "function")
    getAlternate = function() "en-US";

  // Get the bundled properties file for the app's locale
  function getBundle(locale) {
    let propertyPath = "locales/" + locale + ".properties";
    let propertyFile = addon.getResourceURI(propertyPath);

    // Get a bundle and test if it's able to do simple things
    try {
      // Avoid caching issues by always getting a new file
      let uniqueFileSpec = propertyFile.spec + "#" + Math.random();
      let bundle = Services.strings.createBundle(uniqueFileSpec);
      bundle.getSimpleEnumeration();
      return bundle;
    }
    catch(ex) {}

    // The locale must not exist, so give nothing
    return null;
  }

  // Use the current locale or the alternate as the primary bundle
  let locale = Cc["@mozilla.org/chrome/chrome-registry;1"].
    getService(Ci.nsIXULChromeRegistry).getSelectedLocale("global");
  getString.bundle = getBundle(locale) || getBundle(getAlternate(locale));

  // Create a fallback in-case a string is missing
  getString.fallback = getBundle("en-US");

  // Get the appropriate plural form getter
  Cu.import("resource://gre/modules/PluralForm.jsm");
  let rule = getString("pluralRule");
  [getString.plural] = PluralForm.makeGetter(rule);
}

/**
 * Create a trigger that allows adding callbacks by default then triggering all
 * of them.
 */
function makeTrigger() {
  let callbacks = [];

  // Provide the main function to add callbacks that can be removed
  function addCallback(callback) {
    callbacks.push(callback);
    return function() {
      let index = callbacks.indexOf(callback);
      if (index != -1)
        callbacks.splice(index, 1);
    };
  }

  // Provide a way to clear out all the callbacks
  addCallback.reset = function() {
    callbacks.length = 0;
  };

  // Run each callback in order ignoring failures
  addCallback.trigger = function(reason) {
    callbacks.slice().forEach(function(callback) {
      try {
        callback(reason);
      }
      catch(ex) {}
    });
  };

  return addCallback;
}

/**
 * Apply a callback to each open and new browser windows.
 *
 * @usage watchWindows(callback): Apply a callback to each browser window.
 * @param [function] callback: 1-parameter function that gets a browser window.
 */
function watchWindows(callback) {
  // Wrap the callback in a function that ignores failures
  function watcher(window) {
    try {
      callback(window);
    }
    catch(ex) {}
  }

  // Wait for the window to finish loading before running the callback
  function runOnLoad(window) {
    // Listen for one load event before checking the window type
    window.addEventListener("load", function runOnce() {
      window.removeEventListener("load", runOnce, false);

      // Now that the window has loaded, only handle browser windows
      let doc = window.document.documentElement;
      if (doc.getAttribute("windowtype") == "navigator:browser")
        watcher(window);
    }, false);
  }

  // Add functionality to existing windows
  let browserWindows = Services.wm.getEnumerator("navigator:browser");
  while (browserWindows.hasMoreElements()) {
    // Only run the watcher immediately if the browser is completely loaded
    let browserWindow = browserWindows.getNext();
    if (browserWindow.document.readyState == "complete")
      watcher(browserWindow);
    // Wait for the window to load before continuing
    else
      runOnLoad(browserWindow);
  }

  // Watch for new browser windows opening then wait for it to load
  function windowWatcher(subject, topic) {
    if (topic == "domwindowopened")
      runOnLoad(subject);
  }
  Services.ww.registerNotification(windowWatcher);

  // Make sure to stop watching for windows if we're unloading
  unload(function() Services.ww.unregisterNotification(windowWatcher));
}

/**
 * Save callbacks to run when unloading. Optionally scope the callback to a
 * container, e.g., window. Provide a way to run all the callbacks.
 *
 * @usage unload(): Run all callbacks and release them.
 *
 * @usage unload(callback): Add a callback to run on unload.
 * @param [function] callback: 0-parameter function to call on unload.
 * @return [function]: A 0-parameter function that undoes adding the callback.
 *
 * @usage unload(callback, container) Add a scoped callback to run on unload.
 * @param [function] callback: 0-parameter function to call on unload.
 * @param [node] container: Remove the callback when this container unloads.
 * @return [function]: A 0-parameter function that undoes adding the callback.
 */
function unload(callback, container) {
  // Initialize the array of unloaders on the first usage
  let unloaders = unload.unloaders;
  if (unloaders == null)
    unloaders = unload.unloaders = [];

  // Calling with no arguments runs all the unloader callbacks
  if (callback == null) {
    unloaders.slice().forEach(function(unloader) unloader());
    unloaders.length = 0;
    return;
  }

  // The callback is bound to the lifetime of the container if we have one
  if (container != null) {
    // Remove the unloader when the container unloads
    container.addEventListener("unload", removeUnloader, false);

    // Wrap the callback to additionally remove the unload listener
    let origCallback = callback;
    callback = function() {
      container.removeEventListener("unload", removeUnloader, false);
      origCallback();
    }
  }

  // Wrap the callback in a function that ignores failures
  function unloader() {
    try {
      callback();
    }
    catch(ex) {}
  }
  unloaders.push(unloader);

  // Provide a way to remove the unloader
  function removeUnloader() {
    let index = unloaders.indexOf(unloader);
    if (index != -1)
      unloaders.splice(index, 1);
  }
  return removeUnloader;
}

/**
 * Helper that adds event listeners and remembers to remove on unload
 */
function listen(window, node, event, func) {
  node.addEventListener(event, func, true);
  function undoListen() {
    node.removeEventListener(event, func, true);
  }

  // Undo the listener on unload and provide a way to undo everything
  let undoUnload = unload(undoListen, window);
  return function() {
    undoListen();
    undoUnload();
  };
}
