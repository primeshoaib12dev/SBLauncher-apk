#include <jni.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "node.h"

// Starts the Node.js engine inside this process. node::Start can only be called once per process.
extern "C" JNIEXPORT jint JNICALL
Java_com_modbyshoaib_launcher_NodeBridge_startNodeWithArguments(JNIEnv *env, jclass /*clazz*/, jobjectArray arguments, jobjectArray environment) {
    // environment entries look like KEY=VALUE
    jsize envCount = env->GetArrayLength(environment);
    for (jsize i = 0; i < envCount; i++) {
        jstring js = (jstring) env->GetObjectArrayElement(environment, i);
        const char *c = env->GetStringUTFChars(js, nullptr);
        std::string kv(c);
        env->ReleaseStringUTFChars(js, c);
        env->DeleteLocalRef(js);
        size_t eq = kv.find('=');
        if (eq != std::string::npos) {
            setenv(kv.substr(0, eq).c_str(), kv.substr(eq + 1).c_str(), 1);
        }
    }

    // node wants argv as one contiguous block of memory
    jsize argc = env->GetArrayLength(arguments);
    std::vector<std::string> args;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        jstring js = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *c = env->GetStringUTFChars(js, nullptr);
        args.push_back(std::string(c));
        env->ReleaseStringUTFChars(js, c);
        env->DeleteLocalRef(js);
        total += args.back().size() + 1;
    }
    std::vector<char> block(total);
    std::vector<char *> argv;
    size_t offset = 0;
    for (size_t i = 0; i < args.size(); i++) {
        memcpy(&block[offset], args[i].c_str(), args[i].size() + 1);
        argv.push_back(&block[offset]);
        offset += args[i].size() + 1;
    }
    argv.push_back(nullptr);

    return (jint) node::Start((int) args.size(), argv.data());
}
