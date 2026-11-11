package com.modbyshoaib.launcher;

/** JNI entry to the Node.js engine (nodejs-mobile). node::Start may run only once per process. */
public class NodeBridge {
    static {
        System.loadLibrary("node");
        System.loadLibrary("shoaibnode");
    }

    public static native int startNodeWithArguments(String[] arguments, String[] environment);
}
