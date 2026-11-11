cmake_minimum_required(VERSION 3.22.1)
project("shoaibnode")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Headers and libnode.so come from the nodejs-mobile Android release (downloaded by the workflow into app/libnode)
set(LIBNODE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../libnode)
include_directories(${LIBNODE_DIR}/include/node)

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION ${LIBNODE_DIR}/bin/${ANDROID_ABI}/libnode.so)

add_library(shoaibnode SHARED native-lib.cpp)
target_link_libraries(shoaibnode node log)
